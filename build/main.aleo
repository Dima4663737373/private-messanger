program ghost_msg_017.aleo;

record Message:
    owner as address.private;
    sender_hash as field.private;
    recipient_hash as field.private;
    payload as [field; 4u32].private;
    timestamp as u64.private;
    attachment_part1 as field.private;
    attachment_part2 as field.private;

struct EncryptionKey:
    part1 as field;
    part2 as field;

struct DialogPair:
    a as field;
    b as field;

mapping profile_pubkey:
    key as field.public;
    value as EncryptionKey.public;

mapping dialog_last_block:
    key as field.public;
    value as u32.public;

mapping contacts:
    key as field.public;
    value as boolean.public;

mapping channels:
    key as field.public;
    value as field.public;

mapping groups:
    key as field.public;
    value as field.public;

function register_profile:
    input r0 as field.public;
    input r1 as field.public;
    hash.bhp256 self.caller into r2 as field;
    async register_profile r2 r0 r1 into r3;
    output r3 as ghost_msg_017.aleo/register_profile.future;

finalize register_profile:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as field.public;
    cast r1 r2 into r3 as EncryptionKey;
    set r3 into profile_pubkey[r0];

function update_profile:
    input r0 as field.public;
    input r1 as field.public;
    hash.bhp256 self.caller into r2 as field;
    async update_profile r2 r0 r1 into r3;
    output r3 as ghost_msg_017.aleo/update_profile.future;

finalize update_profile:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as field.public;
    cast r1 r2 into r3 as EncryptionKey;
    set r3 into profile_pubkey[r0];

function send_message:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as address.private;
    input r3 as [field; 4u32].public;
    input r4 as u64.public;
    input r5 as field.public;
    input r6 as field.public;
    hash.bhp256 r2 into r7 as field;
    assert.eq r7 r1;
    hash.bhp256 self.caller into r8 as field;
    assert.eq r8 r0;
    cast self.caller r0 r1 r3 r4 r5 r6 into r9 as Message.record;
    cast r2 r0 r1 r3 r4 r5 r6 into r10 as Message.record;
    async send_message r0 r1 into r11;
    output r9 as Message.record;
    output r10 as Message.record;
    output r11 as ghost_msg_017.aleo/send_message.future;

finalize send_message:
    input r0 as field.public;
    input r1 as field.public;
    lt r0 r1 into r2;
    ternary r2 r0 r1 into r3;
    ternary r2 r1 r0 into r4;
    cast r3 r4 into r5 as DialogPair;
    hash.bhp256 r5 into r6 as field;
    set block.height into dialog_last_block[r6];

function update_message:
    input r0 as Message.record;
    input r1 as [field; 4u32].private;
    cast r0.owner r0.sender_hash r0.recipient_hash r1 r0.timestamp r0.attachment_part1 r0.attachment_part2 into r2 as Message.record;
    output r2 as Message.record;

function delete_message:
    input r0 as Message.record;

function clear_history:
    input r0 as field.public;
    hash.bhp256 self.caller into r1 as field;
    async clear_history r1 r0 into r2;
    output r2 as ghost_msg_017.aleo/clear_history.future;

finalize clear_history:
    input r0 as field.public;
    input r1 as field.public;
    lt r0 r1 into r2;
    ternary r2 r0 r1 into r3;
    ternary r2 r1 r0 into r4;
    cast r3 r4 into r5 as DialogPair;
    hash.bhp256 r5 into r6 as field;
    remove dialog_last_block[r6];

function delete_chat:
    input r0 as field.public;
    hash.bhp256 self.caller into r1 as field;
    async delete_chat r1 r0 into r2;
    output r2 as ghost_msg_017.aleo/delete_chat.future;

finalize delete_chat:
    input r0 as field.public;
    input r1 as field.public;
    lt r0 r1 into r2;
    ternary r2 r0 r1 into r3;
    ternary r2 r1 r0 into r4;
    cast r3 r4 into r5 as DialogPair;
    hash.bhp256 r5 into r6 as field;
    remove dialog_last_block[r6];

function add_contact:
    input r0 as field.public;
    hash.bhp256 self.caller into r1 as field;
    async add_contact r1 r0 into r2;
    output r2 as ghost_msg_017.aleo/add_contact.future;

finalize add_contact:
    input r0 as field.public;
    input r1 as field.public;
    add r0 r1 into r2;
    set true into contacts[r2];

function update_contact:
    input r0 as field.public;
    hash.bhp256 self.caller into r1 as field;
    async update_contact r1 r0 into r2;
    output r2 as ghost_msg_017.aleo/update_contact.future;

finalize update_contact:
    input r0 as field.public;
    input r1 as field.public;
    add r0 r1 into r2;
    set true into contacts[r2];

function delete_contact:
    input r0 as field.public;
    hash.bhp256 self.caller into r1 as field;
    async delete_contact r1 r0 into r2;
    output r2 as ghost_msg_017.aleo/delete_contact.future;

finalize delete_contact:
    input r0 as field.public;
    input r1 as field.public;
    add r0 r1 into r2;
    remove contacts[r2];

function create_channel:
    input r0 as field.private;
    input r1 as field.private;
    async create_channel r0 r1 into r2;
    output r2 as ghost_msg_017.aleo/create_channel.future;

finalize create_channel:
    input r0 as field.public;
    input r1 as field.public;
    contains channels[r0] into r2;
    not r2 into r3;
    assert.eq r3 true;
    set r1 into channels[r0];

function create_group:
    input r0 as field.private;
    input r1 as field.private;
    async create_group r0 r1 into r2;
    output r2 as ghost_msg_017.aleo/create_group.future;

finalize create_group:
    input r0 as field.public;
    input r1 as field.public;
    contains groups[r0] into r2;
    not r2 into r3;
    assert.eq r3 true;
    set r1 into groups[r0];

function delete_channel:
    input r0 as field.private;
    input r1 as field.private;
    async delete_channel r0 r1 into r2;
    output r2 as ghost_msg_017.aleo/delete_channel.future;

finalize delete_channel:
    input r0 as field.public;
    input r1 as field.public;
    get channels[r0] into r2;
    assert.eq r2 r1;
    remove channels[r0];

function delete_group:
    input r0 as field.private;
    input r1 as field.private;
    async delete_group r0 r1 into r2;
    output r2 as ghost_msg_017.aleo/delete_group.future;

finalize delete_group:
    input r0 as field.public;
    input r1 as field.public;
    get groups[r0] into r2;
    assert.eq r2 r1;
    remove groups[r0];

constructor:
    assert.eq edition 0u16;
