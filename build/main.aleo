program priv_messenger_leotest_008.aleo;

record Donation:
    owner as address.public;
    sender as address.private;
    recipient as address.private;
    amount as u64.private;
    message as field.private;
    timestamp as u64.private;

struct ProfileInfo:
    name as field;
    bio as field;

struct DonationMeta:
    sender as address;
    recipient as address;
    amount as u64;
    message_hash as field;
    timestamp as u64;

mapping profiles:
    key as address.public;
    value as ProfileInfo.public;

mapping donation_count:
    key as address.public;
    value as u64.public;

mapping donation_index:
    key as field.public;
    value as DonationMeta.public;

mapping sent_donation_count:
    key as address.public;
    value as u64.public;

mapping sent_donation_index:
    key as field.public;
    value as DonationMeta.public;

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
    output r2 as priv_messenger_leotest_008.aleo/create_profile.future;

finalize create_profile:
    input r0 as address.public;
    input r1 as field.public;
    input r2 as field.public;
    cast r1 r2 into r3 as ProfileInfo;
    set r3 into profiles[r0];

function update_profile:
    input r0 as field.public;
    input r1 as field.public;
    async update_profile self.caller r0 r1 into r2;
    output r2 as priv_messenger_leotest_008.aleo/update_profile.future;

finalize update_profile:
    input r0 as address.public;
    input r1 as field.public;
    input r2 as field.public;
    cast r1 r2 into r3 as ProfileInfo;
    set r3 into profiles[r0];

function send_donation:
    input r0 as address.public;
    input r1 as u64.private;
    input r2 as field.private;
    input r3 as u64.public;
    cast r0 self.caller r0 r1 r2 r3 into r4 as Donation.record;
    cast self.caller self.caller r0 r1 r2 r3 into r5 as Donation.record;
    hash.bhp256 r2 into r6 as field;
    async send_donation r0 self.caller r1 r6 r3 into r7;
    output r4 as Donation.record;
    output r5 as Donation.record;
    output r7 as priv_messenger_leotest_008.aleo/send_donation.future;

finalize send_donation:
    input r0 as address.public;
    input r1 as address.public;
    input r2 as u64.public;
    input r3 as field.public;
    input r4 as u64.public;
    get.or_use donation_count[r0] 0u64 into r5;
    hash.bhp256 r0 into r6 as field;
    cast r5 into r7 as field;
    add r6 r7 into r8;
    cast r1 r0 r2 r3 r4 into r9 as DonationMeta;
    set r9 into donation_index[r8];
    add r5 1u64 into r10;
    set r10 into donation_count[r0];
    get.or_use sent_donation_count[r1] 0u64 into r11;
    hash.bhp256 r1 into r12 as field;
    cast r11 into r13 as field;
    add r12 r13 into r14;
    cast r1 r0 r2 r3 r4 into r15 as DonationMeta;
    set r15 into sent_donation_index[r14];
    add r11 1u64 into r16;
    set r16 into sent_donation_count[r1];

function update_contact_name:
    input r0 as address.public;
    input r1 as field.public;
    async update_contact_name self.caller r0 r1 into r2;
    output r2 as priv_messenger_leotest_008.aleo/update_contact_name.future;

finalize update_contact_name:
    input r0 as address.public;
    input r1 as address.public;
    input r2 as field.public;
    hash.bhp256 r0 into r3 as field;
    hash.bhp256 r1 into r4 as field;
    add r3 r4 into r5;
    set r2 into contact_names[r5];

function delete_chat:
    input r0 as address.public;
    async delete_chat self.caller r0 into r1;
    output r1 as priv_messenger_leotest_008.aleo/delete_chat.future;

finalize delete_chat:
    input r0 as address.public;
    input r1 as address.public;
    hash.bhp256 r0 into r2 as field;
    hash.bhp256 r1 into r3 as field;
    add r2 r3 into r4;
    set 1u64 into deleted_chats[r4];

function restore_chat:
    input r0 as address.public;
    async restore_chat self.caller r0 into r1;
    output r1 as priv_messenger_leotest_008.aleo/restore_chat.future;

finalize restore_chat:
    input r0 as address.public;
    input r1 as address.public;
    hash.bhp256 r0 into r2 as field;
    hash.bhp256 r1 into r3 as field;
    add r2 r3 into r4;
    set 0u64 into deleted_chats[r4];

constructor:
    assert.eq edition 0u16;
