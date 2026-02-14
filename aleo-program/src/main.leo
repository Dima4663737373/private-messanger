// Ghost Messenger — Aleo Program
// Registers hashes of secret messages on-chain for proof of existence.
// Supports channels, groups, profiles, and message verification.

program ghost_secret_v1.aleo {

    // ── Mappings ──────────────────────────────────────────────

    // secret_hash → true  (proof that a secret was created)
    mapping secret_hashes: field => bool;

    // secret_hash → sender address hash  (who registered it)
    mapping secret_senders: field => field;

    // user address hash → profile name hash
    mapping profiles: field => field;

    // channel_hash → creator address hash
    mapping channels: field => field;

    // group_hash → creator address hash
    mapping groups: field => field;

    // ── Transitions ──────────────────────────────────────────

    /// Register a secret message hash on-chain.
    /// The hash is computed client-side from the plaintext before encryption.
    /// After registration, anyone can verify the hash existed.
    transition register_secret(secret_hash: field, sender_hash: field) {
        return then finalize(secret_hash, sender_hash);
    }

    finalize register_secret(secret_hash: field, sender_hash: field) {
        let exists: bool = Mapping::contains(secret_hashes, secret_hash);
        assert(!exists);
        Mapping::set(secret_hashes, secret_hash, true);
        Mapping::set(secret_senders, secret_hash, sender_hash);
    }

    /// Register or update a user profile.
    transition register_profile(address_hash: field, name_hash: field) {
        return then finalize(address_hash, name_hash);
    }

    finalize register_profile(address_hash: field, name_hash: field) {
        Mapping::set(profiles, address_hash, name_hash);
    }

    /// Record a message hash on-chain (lightweight proof of communication).
    /// Does NOT store content — only a hash for verifiability.
    transition record_message(
        sender_hash: field,
        recipient_hash: field,
        payload_hash: field
    ) {
        return then finalize(payload_hash, sender_hash);
    }

    finalize record_message(payload_hash: field, sender_hash: field) {
        Mapping::set(secret_senders, payload_hash, sender_hash);
    }

    /// Register a channel on-chain (proof of creation).
    transition create_channel(channel_hash: field, creator_hash: field) {
        return then finalize(channel_hash, creator_hash);
    }

    finalize create_channel(channel_hash: field, creator_hash: field) {
        let exists: bool = Mapping::contains(channels, channel_hash);
        assert(!exists);
        Mapping::set(channels, channel_hash, creator_hash);
    }

    /// Register a group on-chain (proof of creation).
    transition create_group(group_hash: field, creator_hash: field) {
        return then finalize(group_hash, creator_hash);
    }

    finalize create_group(group_hash: field, creator_hash: field) {
        let exists: bool = Mapping::contains(groups, group_hash);
        assert(!exists);
        Mapping::set(groups, group_hash, creator_hash);
    }

    /// Delete a channel on-chain (only creator can delete).
    transition delete_channel(channel_hash: field, creator_hash: field) {
        return then finalize(channel_hash, creator_hash);
    }

    finalize delete_channel(channel_hash: field, creator_hash: field) {
        let stored_creator: field = Mapping::get(channels, channel_hash);
        assert_eq(stored_creator, creator_hash);
        Mapping::remove(channels, channel_hash);
    }

    /// Delete a group on-chain (only creator can delete).
    transition delete_group(group_hash: field, creator_hash: field) {
        return then finalize(group_hash, creator_hash);
    }

    finalize delete_group(group_hash: field, creator_hash: field) {
        let stored_creator: field = Mapping::get(groups, group_hash);
        assert_eq(stored_creator, creator_hash);
        Mapping::remove(groups, group_hash);
    }
}
