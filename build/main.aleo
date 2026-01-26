program priv_messenger_leotest_012.aleo;

record Message:
    owner as address.public;
    sender as address.private;
    recipient as address.private;
    amount as u64.private;
    message as field.private;
    timestamp as u64.private;

struct ProfileInfo:
    name_hash as field;
    bio_hash as field;

struct MessageMeta:
    sender_hash as field;
    recipient_hash as field;
    amount as u64;
    message_hash as field;
    timestamp as u64;

mapping profiles:
    key as address.public;
    value as ProfileInfo.public;

mapping message_count:
    key as address.public;
    value as u64.public;

mapping message_index:
    key as field.public;
    value as MessageMeta.public;

mapping sent_message_count:
    key as address.public;
    value as u64.public;

mapping sent_message_index:
    key as field.public;
    value as MessageMeta.public;

mapping contact_names:
    key as field.public;
    value as field.public;

mapping deleted_chats:
    key as field.public;
    value as u64.public;

function create_profile:
    input r0 as field.public;
    input r1 as field.public;
    async create_profile self.caller r0 r1 into r2;
    output r2 as priv_messenger_leotest_012.aleo/create_profile.future;

finalize create_profile:
    input r0 as address.public;
    input r1 as field.public;
    input r2 as field.public;
    hash.bhp256 r1 into r3 as field;
    hash.bhp256 r2 into r4 as field;
    cast r3 r4 into r5 as ProfileInfo;
    set r5 into profiles[r0];

function update_profile:
    input r0 as field.public;
    input r1 as field.public;
    async update_profile self.caller r0 r1 into r2;
    output r2 as priv_messenger_leotest_012.aleo/update_profile.future;

finalize update_profile:
    input r0 as address.public;
    input r1 as field.public;
    input r2 as field.public;
    hash.bhp256 r1 into r3 as field;
    hash.bhp256 r2 into r4 as field;
    cast r3 r4 into r5 as ProfileInfo;
    set r5 into profiles[r0];

function send_message:
    input r0 as address.private;
    input r1 as u64.private;
    input r2 as field.private;
    input r3 as u64.private;
    cast r0 self.caller r0 r1 r2 r3 into r4 as Message.record;
    cast self.caller self.caller r0 r1 r2 r3 into r5 as Message.record;
    hash.bhp256 r2 into r6 as field;
    async send_message r0 self.caller r1 r6 r3 into r7;
    output r4 as Message.record;
    output r5 as Message.record;
    output r7 as priv_messenger_leotest_012.aleo/send_message.future;

finalize send_message:
    input r0 as address.public;
    input r1 as address.public;
    input r2 as u64.public;
    input r3 as field.public;
    input r4 as u64.public;
    hash.bhp256 r1 into r5 as field;
    hash.bhp256 r0 into r6 as field;
    get.or_use message_count[r0] 0u64 into r7;
    hash.bhp256 r0 into r8 as field;
    cast r7 into r9 as field;
    add r8 r9 into r10;
    cast r5 r6 r2 r3 r4 into r11 as MessageMeta;
    set r11 into message_index[r10];
    add r7 1u64 into r12;
    set r12 into message_count[r0];
    get.or_use sent_message_count[r1] 0u64 into r13;
    hash.bhp256 r1 into r14 as field;
    cast r13 into r15 as field;
    add r14 r15 into r16;
    cast r5 r6 r2 r3 r4 into r17 as MessageMeta;
    set r17 into sent_message_index[r16];
    add r13 1u64 into r18;
    set r18 into sent_message_count[r1];

function update_contact_name:
    input r0 as address.private;
    input r1 as field.private;
    async update_contact_name self.caller r0 r1 into r2;
    output r2 as priv_messenger_leotest_012.aleo/update_contact_name.future;

finalize update_contact_name:
    input r0 as address.public;
    input r1 as address.public;
    input r2 as field.public;
    hash.bhp256 r0 into r3 as field;
    hash.bhp256 r1 into r4 as field;
    add r3 r4 into r5;
    set r2 into contact_names[r5];

function delete_chat:
    input r0 as address.private;
    async delete_chat self.caller r0 into r1;
    output r1 as priv_messenger_leotest_012.aleo/delete_chat.future;

finalize delete_chat:
    input r0 as address.public;
    input r1 as address.public;
    hash.bhp256 r0 into r2 as field;
    hash.bhp256 r1 into r3 as field;
    add r2 r3 into r4;
    set 1u64 into deleted_chats[r4];

function restore_chat:
    input r0 as address.private;
    async restore_chat self.caller r0 into r1;
    output r1 as priv_messenger_leotest_012.aleo/restore_chat.future;

finalize restore_chat:
    input r0 as address.public;
    input r1 as address.public;
    hash.bhp256 r0 into r2 as field;
    hash.bhp256 r1 into r3 as field;
    add r2 r3 into r4;
    set 0u64 into deleted_chats[r4];

constructor:
    assert.eq edition 0u16;
