//! cluster — deciding which node owns which key (data partitioning).
//!
//! This is Step 5a of the engine: the rule that spreads data across many
//! machines. On its own it stores nothing and talks to no network — it is pure
//! logic that answers one question:
//!
//! "Given a key, which node is responsible for it?"
//!
//! ## Why consistent hashing?
//!
//! The naive way to spread keys over N nodes is `hash(key) % N`. It works until
//! you add or remove a node: then N changes, and *almost every* key suddenly
//! maps somewhere else, forcing a massive reshuffle of data.
//!
//! Consistent hashing fixes this. Imagine a clock face (a ring) numbered from 0
//! up to the maximum hash value and back to 0. Every node is placed at several
//! points around the ring. To find a key's owner, hash the key to a point on
//! the ring, then walk clockwise to the first node you meet — that node owns the
//! key. When a node joins or leaves, only the keys in the arc next to it move;
//! everyone else stays put. This is the same idea ScyllaDB, Cassandra, and
//! DynamoDB use.
//!
//! ## Virtual nodes
//!
//! If each physical node sat at a single point, the ring would be lumpy and some
//! nodes would get far more keys than others. So we place each node at many
//! points (called "virtual nodes" or "vnodes"). More points = smoother, more
//! even distribution.

use std::collections::BTreeMap;

/// How many points each physical node occupies on the ring.
/// More vnodes spread keys more evenly, at the cost of a little memory.
const DEFAULT_VNODES: u32 = 128;

/// A consistent-hashing ring that maps keys to node names.
///
/// `nodes` remembers which physical nodes exist. `ring` is the sorted clock
/// face: each entry maps a point (a hash) to the node that owns that point.
#[derive(Debug, Clone)]
pub struct Ring {
    /// Sorted map from ring position -> node name. The heart of the structure.
    ring: BTreeMap<u64, String>,
    /// The set of physical node names currently in the cluster.
    nodes: Vec<String>,
    /// How many points each node is given on the ring.
    vnodes: u32,
}

impl Ring {
    /// Create an empty ring with the default number of virtual nodes per node.
    pub fn new() -> Self {
        Ring::with_vnodes(DEFAULT_VNODES)
    }

    /// Create an empty ring, choosing how many virtual nodes each node gets.
    pub fn with_vnodes(vnodes: u32) -> Self {
        Ring {
            ring: BTreeMap::new(),
            nodes: Vec::new(),
            // At least one point per node, otherwise the ring would be empty.
            vnodes: vnodes.max(1),
        }
    }

    /// Build a ring already populated with the given node names.
    pub fn from_nodes<I, S>(names: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let mut ring = Ring::new();
        for name in names {
            ring.add_node(name);
        }
        ring
    }

    /// Add a node to the cluster. Does nothing if the node is already present.
    ///
    /// This scatters `vnodes` points for the node around the ring. Only the keys
    /// that land in those new arcs will later route to this node.
    pub fn add_node<S: Into<String>>(&mut self, name: S) {
        let name = name.into();
        if self.nodes.iter().any(|n| n == &name) {
            return; // already a member
        }

        for v in 0..self.vnodes {
            let point = hash_vnode(&name, v);
            // In the rare case two points collide, keep walking until we find a
            // free slot so we never silently lose a node's presence.
            let mut slot = point;
            while self.ring.contains_key(&slot) {
                slot = slot.wrapping_add(1);
            }
            self.ring.insert(slot, name.clone());
        }
        self.nodes.push(name);
    }

    /// Remove a node from the cluster. Does nothing if it was not a member.
    ///
    /// Its points are taken off the ring; the keys it held will route to the
    /// next node clockwise. No other node's keys move.
    pub fn remove_node(&mut self, name: &str) {
        if !self.nodes.iter().any(|n| n == name) {
            return;
        }
        self.ring.retain(|_, owner| owner != name);
        self.nodes.retain(|n| n != name);
    }

    /// Find the node that owns `key`, or `None` if the ring is empty.
    ///
    /// Hash the key to a point, then walk clockwise to the first node at or
    /// after that point. If we run off the end of the ring, wrap around to the
    /// very first node (the ring is a circle).
    pub fn node_for_key(&self, key: &[u8]) -> Option<&str> {
        if self.ring.is_empty() {
            return None;
        }
        let point = hash_key(key);

        // First entry whose position is >= point (clockwise neighbour).
        if let Some((_, owner)) = self.ring.range(point..).next() {
            return Some(owner);
        }
        // Walked past the top of the ring — wrap to the first node.
        self.ring.values().next().map(|s| s.as_str())
    }

    /// The `n` distinct nodes that own a key, starting with the primary owner
    /// and continuing clockwise. This is the basis for replication (Step 6):
    /// store each key on its primary node plus the next few nodes.
    ///
    /// Returns fewer than `n` names only if the cluster has fewer than `n` nodes.
    pub fn nodes_for_key(&self, key: &[u8], n: usize) -> Vec<&str> {
        if self.ring.is_empty() || n == 0 {
            return Vec::new();
        }
        let point = hash_key(key);
        let mut owners: Vec<&str> = Vec::new();

        // Walk clockwise from the key's point, then wrap around, collecting
        // distinct node names until we have `n` of them (or run out of nodes).
        let want = n.min(self.nodes.len());
        let clockwise = self.ring.range(point..).chain(self.ring.range(..point));
        for (_, owner) in clockwise {
            if !owners.iter().any(|o| *o == owner.as_str()) {
                owners.push(owner.as_str());
                if owners.len() == want {
                    break;
                }
            }
        }
        owners
    }

    /// The list of physical node names in the cluster.
    pub fn nodes(&self) -> &[String] {
        &self.nodes
    }

    /// How many physical nodes are in the cluster.
    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    /// True if the cluster has no nodes yet.
    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }
}

impl Default for Ring {
    fn default() -> Self {
        Ring::new()
    }
}

// ----------------------------------------------------------------------------
// Hashing. A self-contained FNV-1a so this module stands alone.
// ----------------------------------------------------------------------------

const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

/// Hash a key to a point on the ring.
fn hash_key(key: &[u8]) -> u64 {
    mix(fold(FNV_OFFSET, key))
}

/// Hash one virtual node ("node#3") to a point on the ring. Mixing the node
/// name with the vnode index spreads a single node's points all over the ring.
fn hash_vnode(name: &str, index: u32) -> u64 {
    let mut hash = FNV_OFFSET;
    hash = fold(hash, name.as_bytes());
    hash = fold(hash, b"#");
    hash = fold(hash, &index.to_le_bytes());
    mix(hash)
}

/// Mix more bytes into a running FNV-1a hash.
fn fold(mut hash: u64, data: &[u8]) -> u64 {
    for &byte in data {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}

/// A bit-mixing finalizer (the splitmix64 finalizer). FNV-1a alone has weak
/// avalanche — similar inputs land near each other, making the ring lumpy. This
/// scrambles the bits so points scatter evenly across the whole 0..u64::MAX
/// range, which is what consistent hashing needs for an even spread.
fn mix(mut z: u64) -> u64 {
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ (z >> 31)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_ring_owns_nothing() {
        let ring = Ring::new();
        assert!(ring.is_empty());
        assert_eq!(ring.node_for_key(b"anything"), None);
    }

    #[test]
    fn single_node_owns_every_key() {
        let mut ring = Ring::new();
        ring.add_node("node-a");
        assert_eq!(ring.node_for_key(b"foo"), Some("node-a"));
        assert_eq!(ring.node_for_key(b"bar"), Some("node-a"));
        assert_eq!(ring.node_for_key(b""), Some("node-a"));
    }

    #[test]
    fn same_key_always_routes_to_same_node() {
        let ring = Ring::from_nodes(["a", "b", "c"]);
        let first = ring.node_for_key(b"user:42").unwrap().to_string();
        for _ in 0..100 {
            assert_eq!(ring.node_for_key(b"user:42"), Some(first.as_str()));
        }
    }

    #[test]
    fn adding_a_node_is_idempotent() {
        let mut ring = Ring::new();
        ring.add_node("a");
        ring.add_node("a");
        assert_eq!(ring.len(), 1);
    }

    #[test]
    fn keys_spread_across_nodes() {
        let ring = Ring::from_nodes(["a", "b", "c", "d"]);
        let mut seen = std::collections::HashSet::new();
        for i in 0..1000 {
            let key = format!("key-{i}");
            seen.insert(ring.node_for_key(key.as_bytes()).unwrap().to_string());
        }
        // With 1000 keys and 4 nodes, every node should get at least some keys.
        assert_eq!(seen.len(), 4);
    }

    #[test]
    fn distribution_is_reasonably_even() {
        let ring = Ring::from_nodes(["a", "b", "c", "d"]);
        let mut counts = std::collections::HashMap::new();
        let total = 10_000;
        for i in 0..total {
            let key = format!("key-{i}");
            let owner = ring.node_for_key(key.as_bytes()).unwrap().to_string();
            *counts.entry(owner).or_insert(0u32) += 1;
        }
        // A perfectly even split is 25% each. With 128 vnodes per node we expect
        // every node to land comfortably within 15%..35%.
        for (_, count) in counts {
            let share = count as f64 / total as f64;
            assert!(
                (0.15..0.35).contains(&share),
                "uneven share: {share}"
            );
        }
    }

    #[test]
    fn removing_a_node_moves_only_its_keys() {
        let ring = Ring::from_nodes(["a", "b", "c"]);

        // Record where every key lives now.
        let keys: Vec<String> = (0..2000).map(|i| format!("key-{i}")).collect();
        let before: Vec<String> = keys
            .iter()
            .map(|k| ring.node_for_key(k.as_bytes()).unwrap().to_string())
            .collect();

        // Remove node "b".
        let mut ring2 = ring.clone();
        ring2.remove_node("b");
        assert_eq!(ring2.len(), 2);

        // Any key that was NOT on "b" must stay exactly where it was.
        for (key, old_owner) in keys.iter().zip(&before) {
            let new_owner = ring2.node_for_key(key.as_bytes()).unwrap();
            if old_owner != "b" {
                assert_eq!(
                    new_owner, old_owner,
                    "key {key} moved even though its node stayed"
                );
            } else {
                assert_ne!(new_owner, "b", "key {key} still points at removed node");
            }
        }
    }

    #[test]
    fn nodes_for_key_returns_distinct_owners_for_replication() {
        let ring = Ring::from_nodes(["a", "b", "c", "d"]);
        let owners = ring.nodes_for_key(b"user:42", 3);
        assert_eq!(owners.len(), 3);

        // The first owner must match the single-owner lookup.
        assert_eq!(owners[0], ring.node_for_key(b"user:42").unwrap());

        // All replica owners must be distinct.
        let mut sorted = owners.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), 3);
    }

    #[test]
    fn nodes_for_key_caps_at_cluster_size() {
        let ring = Ring::from_nodes(["a", "b"]);
        // Asking for 5 replicas when only 2 nodes exist returns 2.
        assert_eq!(ring.nodes_for_key(b"k", 5).len(), 2);
    }
}
