//! A tiny fixed-size thread pool — written with ONLY the standard library.
//!
//! Why this exists (Step 7: concurrency):
//!
//! The original server handled one connection at a time. While it read a slow
//! client's request or ran one query, every other client had to wait in line.
//! On an 8-core machine, 7 cores sat idle. That means the fast engine we built
//! could only ever serve "one core's worth" of traffic.
//!
//! A thread pool fixes this. We start a fixed number of worker threads up front
//! (usually one per CPU core). Each incoming connection becomes a small "job"
//! that we hand to whichever worker is free. Now many clients are served at the
//! same time, across all cores.
//!
//! We use a fixed pool (not "one new thread per connection") so a flood of
//! clients can't spawn unlimited threads and exhaust the machine.

use std::sync::{mpsc, Arc, Mutex};
use std::thread;

/// A unit of work for a worker to run: any closure we can send to another thread.
type Job = Box<dyn FnOnce() + Send + 'static>;

/// A pool of worker threads that run jobs handed to it via [`ThreadPool::execute`].
pub struct ThreadPool {
    workers: Vec<Worker>,
    /// The sending half of the job queue. Wrapped in `Option` so that on
    /// shutdown we can drop it — which closes the channel and tells every
    /// worker to stop.
    sender: Option<mpsc::Sender<Job>>,
}

impl ThreadPool {
    /// Create a pool with `size` worker threads (clamped to at least 1).
    pub fn new(size: usize) -> ThreadPool {
        let size = size.max(1);

        // One queue shared by all workers. `Receiver` isn't shareable on its
        // own, so we wrap it in `Arc<Mutex<..>>`: workers take turns locking it
        // to pull the next job. Whichever worker grabs the lock first gets the job.
        let (sender, receiver) = mpsc::channel::<Job>();
        let receiver = Arc::new(Mutex::new(receiver));

        let mut workers = Vec::with_capacity(size);
        for _ in 0..size {
            workers.push(Worker::new(Arc::clone(&receiver)));
        }

        ThreadPool {
            workers,
            sender: Some(sender),
        }
    }

    /// Hand a job to the pool. It runs on the next free worker thread.
    pub fn execute<F>(&self, f: F)
    where
        F: FnOnce() + Send + 'static,
    {
        let job = Box::new(f);
        if let Some(sender) = &self.sender {
            // If sending fails the pool is shutting down; just drop the job.
            let _ = sender.send(job);
        }
    }
}

impl Drop for ThreadPool {
    /// Clean shutdown: close the queue, then wait for every worker to finish.
    fn drop(&mut self) {
        // Dropping the sender closes the channel; each worker's `recv()` then
        // returns an error, which breaks its loop so the thread can exit.
        drop(self.sender.take());

        for worker in &mut self.workers {
            if let Some(handle) = worker.handle.take() {
                let _ = handle.join();
            }
        }
    }
}

/// One worker thread, sitting in a loop pulling jobs off the shared queue.
struct Worker {
    handle: Option<thread::JoinHandle<()>>,
}

impl Worker {
    fn new(receiver: Arc<Mutex<mpsc::Receiver<Job>>>) -> Worker {
        let handle = thread::spawn(move || loop {
            // Lock the queue just long enough to take one job, then release the
            // lock BEFORE running it — so other workers can grab the next job
            // while this one is busy.
            let message = receiver.lock().unwrap().recv();
            match message {
                Ok(job) => job(),
                // Channel closed (pool dropped) -> time to shut down.
                Err(_) => break,
            }
        });

        Worker {
            handle: Some(handle),
        }
    }
}
