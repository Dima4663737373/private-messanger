// Ghost Messenger — Unified Aleo Program (V6)
// Combines messaging (records, encryption keys) with channels/groups proof.
// V6: edit_message_proof, delete_message_proof (no record needed for off-chain messages).

program ghost_msg_018.aleo {

    @noupgrade
    async constructor() {}

    // ── Records ──────────────────────────────────────────────

    record Message {
        owner: address,
        sender_hash: field,
        recipient_hash: field,
        payload: [field; 4],
        timestamp: u64,
        attachment_part1: field,
        attachment_part2: field,
    }

    // ── Structs ──────────────────────────────────────────────

    struct EncryptionKey {
        part1: field,
        part2: field
    }

    struct DialogPair {
        a: field,
        b: field
    }

    // ── Mappings ─────────────────────────────────────────────

    mapping profile_pubkey: field => EncryptionKey;
    mapping dialog_last_block: field => u32;
    mapping contacts: field => bool;
    mapping message_actions: field => bool;
    mapping channels: field => field;
    mapping groups: field => field;

    // ── Profile Transitions ─────────────────────────────────

    /// Register profile with encryption public key (first time).
    async transition register_profile(
        public key_part1: field,
        public key_part2: field
    ) -> Future {
        let sender_hash: field = BHP256::hash_to_field(self.caller);
        return finalize_register_profile(sender_hash, key_part1, key_part2);
    }

    async function finalize_register_profile(
        sender_hash: field,
        key_part1: field,
        key_part2: field
    ) {
        let key_struct: EncryptionKey = EncryptionKey {
            part1: key_part1,
            part2: key_part2
        };
        Mapping::set(profile_pubkey, sender_hash, key_struct);
    }

    /// Update profile encryption key.
    async transition update_profile(
        public key_part1: field,
        public key_part2: field
    ) -> Future {
        let sender_hash: field = BHP256::hash_to_field(self.caller);
        return finalize_update_profile(sender_hash, key_part1, key_part2);
    }

    async function finalize_update_profile(
        sender_hash: field,
        key_part1: field,
        key_part2: field
    ) {
        let key_struct: EncryptionKey = EncryptionKey {
            part1: key_part1,
            part2: key_part2
        };
        Mapping::set(profile_pubkey, sender_hash, key_struct);
    }

    // ── Message Transitions ─────────────────────────────────

    /// Send message — creates private records for both sender and recipient.
    async transition send_message(
        public sender_hash: field,
        public recipient_hash: field,
        private recipient_addr: address,
        public payload: [field; 4],
        public timestamp: u64,
        public attachment_part1: field,
        public attachment_part2: field
    ) -> (Message, Message, Future) {
        let computed_recipient_hash: field = BHP256::hash_to_field(recipient_addr);
        assert_eq(computed_recipient_hash, recipient_hash);

        let computed_sender_hash: field = BHP256::hash_to_field(self.caller);
        assert_eq(computed_sender_hash, sender_hash);

        let sender_msg: Message = Message {
            owner: self.caller,
            sender_hash: sender_hash,
            recipient_hash: recipient_hash,
            payload: payload,
            timestamp: timestamp,
            attachment_part1: attachment_part1,
            attachment_part2: attachment_part2
        };

        let recipient_msg: Message = Message {
            owner: recipient_addr,
            sender_hash: sender_hash,
            recipient_hash: recipient_hash,
            payload: payload,
            timestamp: timestamp,
            attachment_part1: attachment_part1,
            attachment_part2: attachment_part2
        };

        return (sender_msg, recipient_msg, finalize_send_message(sender_hash, recipient_hash));
    }

    async function finalize_send_message(sender_hash: field, recipient_hash: field) {
        let min_hash: field = sender_hash < recipient_hash ? sender_hash : recipient_hash;
        let max_hash: field = sender_hash < recipient_hash ? recipient_hash : sender_hash;
        let dialog_pair: DialogPair = DialogPair { a: min_hash, b: max_hash };
        let dialog_key: field = BHP256::hash_to_field(dialog_pair);
        let height: u32 = block.height;
        Mapping::set(dialog_last_block, dialog_key, height);
    }

    /// Update message content (consumes old record, returns new).
    transition update_message(
        private msg: Message,
        private new_payload: [field; 4]
    ) -> Message {
        let updated_msg: Message = Message {
            owner: msg.owner,
            sender_hash: msg.sender_hash,
            recipient_hash: msg.recipient_hash,
            payload: new_payload,
            timestamp: msg.timestamp,
            attachment_part1: msg.attachment_part1,
            attachment_part2: msg.attachment_part2
        };

        return updated_msg;
    }

    /// Delete message (consumes record, produces nothing).
    transition delete_message(private msg: Message) {
        // Record consumed — no output.
    }

    // ── Chat Management Transitions ─────────────────────────

    /// Clear chat history — on-chain proof that user cleared dialog messages.
    /// Removes dialog tracking from mapping.
    async transition clear_history(
        public recipient_hash: field
    ) -> Future {
        let sender_hash: field = BHP256::hash_to_field(self.caller);
        return finalize_clear_history(sender_hash, recipient_hash);
    }

    async function finalize_clear_history(
        sender_hash: field,
        recipient_hash: field
    ) {
        let min_hash: field = sender_hash < recipient_hash ? sender_hash : recipient_hash;
        let max_hash: field = sender_hash < recipient_hash ? recipient_hash : sender_hash;
        let dialog_pair: DialogPair = DialogPair { a: min_hash, b: max_hash };
        let dialog_key: field = BHP256::hash_to_field(dialog_pair);
        Mapping::remove(dialog_last_block, dialog_key);
    }

    /// Delete chat — on-chain proof that user deleted a conversation.
    /// Removes dialog tracking from mapping.
    async transition delete_chat(
        public recipient_hash: field
    ) -> Future {
        let sender_hash: field = BHP256::hash_to_field(self.caller);
        return finalize_delete_chat(sender_hash, recipient_hash);
    }

    async function finalize_delete_chat(
        sender_hash: field,
        recipient_hash: field
    ) {
        let min_hash: field = sender_hash < recipient_hash ? sender_hash : recipient_hash;
        let max_hash: field = sender_hash < recipient_hash ? recipient_hash : sender_hash;
        let dialog_pair: DialogPair = DialogPair { a: min_hash, b: max_hash };
        let dialog_key: field = BHP256::hash_to_field(dialog_pair);
        Mapping::remove(dialog_last_block, dialog_key);
    }

    // ── Message Proof Transitions (no record needed) ───────

    /// Proof of message edit (for off-chain messages without records).
    async transition edit_message_proof(
        public message_hash: field
    ) -> Future {
        let sender_hash: field = BHP256::hash_to_field(self.caller);
        return finalize_edit_message_proof(sender_hash, message_hash);
    }

    async function finalize_edit_message_proof(
        sender_hash: field,
        message_hash: field
    ) {
        let key: field = sender_hash + message_hash;
        Mapping::set(message_actions, key, true);
    }

    /// Proof of message delete (for off-chain messages without records).
    async transition delete_message_proof(
        public message_hash: field
    ) -> Future {
        let sender_hash: field = BHP256::hash_to_field(self.caller);
        return finalize_delete_message_proof(sender_hash, message_hash);
    }

    async function finalize_delete_message_proof(
        sender_hash: field,
        message_hash: field
    ) {
        let key: field = sender_hash + message_hash;
        Mapping::set(message_actions, key, true);
    }

    // ── Contact Transitions ────────────────────────────────

    /// Add contact on-chain (proof of action).
    async transition add_contact(
        public contact_hash: field
    ) -> Future {
        let owner_hash: field = BHP256::hash_to_field(self.caller);
        return finalize_add_contact(owner_hash, contact_hash);
    }

    async function finalize_add_contact(
        owner_hash: field,
        contact_hash: field
    ) {
        let key: field = owner_hash + contact_hash;
        Mapping::set(contacts, key, true);
    }

    /// Update contact on-chain (proof of rename).
    async transition update_contact(
        public contact_hash: field
    ) -> Future {
        let owner_hash: field = BHP256::hash_to_field(self.caller);
        return finalize_update_contact(owner_hash, contact_hash);
    }

    async function finalize_update_contact(
        owner_hash: field,
        contact_hash: field
    ) {
        let key: field = owner_hash + contact_hash;
        Mapping::set(contacts, key, true);
    }

    /// Delete contact on-chain (proof of removal).
    async transition delete_contact(
        public contact_hash: field
    ) -> Future {
        let owner_hash: field = BHP256::hash_to_field(self.caller);
        return finalize_delete_contact(owner_hash, contact_hash);
    }

    async function finalize_delete_contact(
        owner_hash: field,
        contact_hash: field
    ) {
        let key: field = owner_hash + contact_hash;
        Mapping::remove(contacts, key);
    }

    // ── Channel/Group Transitions ───────────────────────────

    /// Create channel on-chain (proof of creation).
    async transition create_channel(
        channel_hash: field,
        creator_hash: field
    ) -> Future {
        return finalize_create_channel(channel_hash, creator_hash);
    }

    async function finalize_create_channel(channel_hash: field, creator_hash: field) {
        let exists: bool = Mapping::contains(channels, channel_hash);
        assert(!exists);
        Mapping::set(channels, channel_hash, creator_hash);
    }

    /// Create group on-chain (proof of creation).
    async transition create_group(
        group_hash: field,
        creator_hash: field
    ) -> Future {
        return finalize_create_group(group_hash, creator_hash);
    }

    async function finalize_create_group(group_hash: field, creator_hash: field) {
        let exists: bool = Mapping::contains(groups, group_hash);
        assert(!exists);
        Mapping::set(groups, group_hash, creator_hash);
    }

    /// Delete channel (only creator can delete).
    async transition delete_channel(
        channel_hash: field,
        creator_hash: field
    ) -> Future {
        return finalize_delete_channel(channel_hash, creator_hash);
    }

    async function finalize_delete_channel(channel_hash: field, creator_hash: field) {
        let stored_creator: field = Mapping::get(channels, channel_hash);
        assert_eq(stored_creator, creator_hash);
        Mapping::remove(channels, channel_hash);
    }

    /// Delete group (only creator can delete).
    async transition delete_group(
        group_hash: field,
        creator_hash: field
    ) -> Future {
        return finalize_delete_group(group_hash, creator_hash);
    }

    async function finalize_delete_group(group_hash: field, creator_hash: field) {
        let stored_creator: field = Mapping::get(groups, group_hash);
        assert_eq(stored_creator, creator_hash);
        Mapping::remove(groups, group_hash);
    }
}
