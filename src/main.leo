program priv_messenger_leotest_010.aleo {
    // This is the constructor for the program.
    // It is called when the program is deployed.
    @noupgrade
    async constructor() {}

    // Profile information struct (privacy-preserving)
    struct ProfileInfo {
        name_hash: field,    // Hashed name for privacy
        bio_hash: field,     // Hashed bio for privacy
    }

    // Message record (private, encrypted)
    record Message {
        public owner: address,
        sender: address,
        recipient: address,
        amount: u64,
        message: field,
        timestamp: u64,
    }

    // Message metadata for indexing (public, privacy-preserving)
    struct MessageMeta {
        sender_hash: field,      // Hashed sender address for privacy
        recipient_hash: field,    // Hashed recipient address for privacy
        amount: u64,
        message_hash: field,
        timestamp: u64,
    }

    // Profiles mapping
    mapping profiles: address => ProfileInfo;

    // Count of messages per recipient
    mapping message_count: address => u64;

    // Message index: key = hash(recipient, index) => MessageMeta
    mapping message_index: field => MessageMeta;

    // Count of sent messages per sender
    mapping sent_message_count: address => u64;

    // Sent message index: key = hash(sender, index) => MessageMeta
    mapping sent_message_index: field => MessageMeta;

    // Contact name mapping: key = hash(user, contact_address) => contact_name
    mapping contact_names: field => field;

    // Deleted chats mapping: key = hash(user, contact_address) => deleted (1 = deleted, 0 = active)
    mapping deleted_chats: field => u64;

    // Create or update profile
    async transition create_profile(public name: field, public bio: field) -> Future {
        return finalize_create_profile(self.caller, name, bio);
    }

    async function finalize_create_profile(user: address, name: field, bio: field) {
        // Hash profile data for privacy
        let name_hash: field = BHP256::hash_to_field(name);
        let bio_hash: field = BHP256::hash_to_field(bio);
        
        let info: ProfileInfo = ProfileInfo {
            name_hash: name_hash,
            bio_hash: bio_hash
        };
        Mapping::set(profiles, user, info);
    }

    // Update profile
    async transition update_profile(public name: field, public bio: field) -> Future {
        return finalize_update_profile(self.caller, name, bio);
    }

    async function finalize_update_profile(user: address, name: field, bio: field) {
        // Hash profile data for privacy
        let name_hash: field = BHP256::hash_to_field(name);
        let bio_hash: field = BHP256::hash_to_field(bio);
        
        let info: ProfileInfo = ProfileInfo {
            name_hash: name_hash,
            bio_hash: bio_hash
        };
        Mapping::set(profiles, user, info);
    }

    // Send message with encryption
    // recipient is private for maximum privacy
    // Public mappings use hashed addresses to preserve anonymity
    async transition send_message(
        private recipient: address,
        private amount: u64,
        private message: field,
        private timestamp: u64
    ) -> (Message, Message, Future) {
        let sender: address = self.caller;
        
        // Create recipient message record (owned by recipient)
        let recipient_message: Message = Message {
            owner: recipient,
            sender: sender,
            recipient: recipient,
            amount: amount,
            message: message,
            timestamp: timestamp,
        };

        // Create sender message record (owned by sender)
        let sender_message: Message = Message {
            owner: sender,
            sender: sender,
            recipient: recipient,
            amount: amount,
            message: message,
            timestamp: timestamp,
        };

        // Hash message for indexing (privacy-preserving)
        let message_hash: field = BHP256::hash_to_field(message);
        
        // Pass metadata to finalize for indexing
        return (recipient_message, sender_message, finalize_send_message(recipient, sender, amount, message_hash, timestamp));
    }

    async function finalize_send_message(
        recipient: address,
        sender: address,
        amount: u64,
        message_hash: field,
        timestamp: u64
    ) {
        // Use passed timestamp logic

        // Hash addresses for privacy in public mappings
        let sender_hash: field = BHP256::hash_to_field(sender);
        let recipient_hash: field = BHP256::hash_to_field(recipient);
        
        // Index for recipient (received messages)
        let recipient_count: u64 = Mapping::get_or_use(message_count, recipient, 0u64);
        let recipient_field: field = BHP256::hash_to_field(recipient);
        let recipient_index_key: field = recipient_field + (recipient_count as field);
        
        let recipient_meta: MessageMeta = MessageMeta {
            sender_hash: sender_hash,
            recipient_hash: recipient_hash,
            amount: amount,
            message_hash: message_hash,
            timestamp: timestamp,
        };
        Mapping::set(message_index, recipient_index_key, recipient_meta);
        Mapping::set(message_count, recipient, recipient_count + 1u64);

        // Index for sender (sent messages)
        let sender_count: u64 = Mapping::get_or_use(sent_message_count, sender, 0u64);
        let sender_field: field = BHP256::hash_to_field(sender);
        let sender_index_key: field = sender_field + (sender_count as field);
        
        let sender_meta: MessageMeta = MessageMeta {
            sender_hash: sender_hash,
            recipient_hash: recipient_hash,
            amount: amount,
            message_hash: message_hash,
            timestamp: timestamp,
        };
        Mapping::set(sent_message_index, sender_index_key, sender_meta);
        Mapping::set(sent_message_count, sender, sender_count + 1u64);
    }

    // Update contact name (local to user, privacy-preserving)
    async transition update_contact_name(
        private contact_address: address,
        private contact_name: field
    ) -> Future {
        return finalize_update_contact_name(self.caller, contact_address, contact_name);
    }

    async function finalize_update_contact_name(
        user: address,
        contact_address: address,
        contact_name: field
    ) {
        // Create composite key: hash(user_address + contact_address)
        let user_field: field = BHP256::hash_to_field(user);
        let contact_field: field = BHP256::hash_to_field(contact_address);
        let key: field = user_field + contact_field;
        Mapping::set(contact_names, key, contact_name);
    }

    // Delete/archive chat (local to user, privacy-preserving)
    async transition delete_chat(private contact_address: address) -> Future {
        return finalize_delete_chat(self.caller, contact_address);
    }

    async function finalize_delete_chat(
        user: address,
        contact_address: address
    ) {
        // Create composite key: hash(user_address + contact_address)
        let user_field: field = BHP256::hash_to_field(user);
        let contact_field: field = BHP256::hash_to_field(contact_address);
        let key: field = user_field + contact_field;
        Mapping::set(deleted_chats, key, 1u64);
    }

    // Restore chat (local to user, privacy-preserving)
    async transition restore_chat(private contact_address: address) -> Future {
        return finalize_restore_chat(self.caller, contact_address);
    }

    async function finalize_restore_chat(
        user: address,
        contact_address: address
    ) {
        // Create composite key: hash(user_address + contact_address)
        let user_field: field = BHP256::hash_to_field(user);
        let contact_field: field = BHP256::hash_to_field(contact_address);
        let key: field = user_field + contact_field;
        Mapping::set(deleted_chats, key, 0u64);
    }
}