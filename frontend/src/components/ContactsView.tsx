
import React, { useState } from 'react';
import { Contact, NetworkProfile } from '../types';
import { Plus, UserPlus, X, Search, MessageSquare, Check, UserX, Globe, Info, Pencil, Trash2 } from 'lucide-react';
import Avatar from './Avatar';
import { EmptyState } from './ui/EmptyState';
import { ContactSkeleton } from './ui/Skeleton';
import { toast } from 'react-hot-toast';

interface ContactsViewProps {
  contacts: Contact[];
  onAddContact: (address: string, name: string) => void;
  onEditContact?: (id: string, newName: string) => void;
  onDeleteContact?: (id: string) => void;
  onSelectContact: (id: string) => void;
  onSearchNetwork?: (query: string) => Promise<NetworkProfile[]>;
  onViewProfile?: (contact: Contact | NetworkProfile) => void;
}

const ContactsView: React.FC<ContactsViewProps> = ({ contacts, onAddContact, onEditContact, onDeleteContact, onSelectContact, onSearchNetwork, onViewProfile }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [newAddress, setNewAddress] = useState('');
  const [newName, setNewName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [networkResults, setNetworkResults] = useState<NetworkProfile[]>([]);
  const [isSearchingNetwork, setIsSearchingNetwork] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  
  // Debounce network search
  React.useEffect(() => {
    const timer = setTimeout(async () => {
      if (searchQuery.length > 2 && onSearchNetwork) {
        setIsSearchingNetwork(true);
        try {
          const results = await onSearchNetwork(searchQuery);
          setNetworkResults(results);
        } catch {
          // Silently ignore search errors during typing (debounce may cause stale requests)
        } finally {
          setIsSearchingNetwork(false);
        }
      } else {
        setNetworkResults([]);
      }
    }, 500); // 500ms debounce

    return () => clearTimeout(timer);
  }, [searchQuery, onSearchNetwork]);

  const filteredContacts = contacts.filter(c => 
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (c.address && c.address.includes(searchQuery))
  );

  const isAddressQuery = searchQuery.startsWith('aleo1') && searchQuery.length >= 60;
  const isAddressInLocal = filteredContacts.some(c => c.address === searchQuery);
  const isAddressInNetwork = networkResults.some(r => r.address === searchQuery);
  const showDirectAdd = isAddressQuery && !isAddressInLocal && !isAddressInNetwork;

  const handleAdd = () => {
    if (!newName.trim()) {
      toast.error('Please enter a display name');
      return;
    }
    if (!newAddress.startsWith('aleo1') || newAddress.length < 60) {
      toast.error('Invalid Aleo address. Must start with aleo1 and be at least 60 characters.');
      return;
    }
    onAddContact(newAddress, newName.trim());
    toast.success(`Contact ${newName.trim()} added`);
    setNewAddress('');
    setNewName('');
    setIsAdding(false);
  };

  const isContactAdded = (address: string) => contacts.some(c => c.address === address);

  return (
    <div className="flex-1 bg-[#FAFAFA] flex flex-col h-screen overflow-hidden animate-slide-up">
      <div className="p-8 pb-4">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-4xl font-bold mb-2 tracking-tighter text-[#0A0A0A]">CONTACTS</h2>
            <p className="text-[#666]">Manage your encrypted network</p>
          </div>
          <button 
            onClick={() => setIsAdding(true)}
            className="bg-white border border-[#E5E5E5] text-[#0A0A0A] px-6 py-3 rounded-xl font-bold hover:border-[#FF8C00] transition-all flex items-center gap-2"
          >
            <Plus size={20} />
            MANUAL ADD
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#999]" size={20} />
          <input
            type="text"
            placeholder="Search contacts or find people on network..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white border border-[#E5E5E5] rounded-2xl py-4 pl-12 pr-4 text-lg focus:outline-none focus:border-[#FF8C00] transition-colors shadow-sm text-black"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-8">
        
        {/* Local Contacts Section */}
        {contacts.length > 0 && (
          <div>
            <h3 className="text-sm font-bold text-[#666] uppercase tracking-wider mb-4">
              {searchQuery ? 'My Contacts' : 'All Contacts'}
            </h3>
            {filteredContacts.length === 0 ? (
               <p className="text-[#666] italic">No local contacts match your search.</p>
            ) : (
              <div className="space-y-4">
                {filteredContacts.map(contact => (
                  <div 
                    key={contact.id}
                    className="bg-white p-4 rounded-2xl border border-[#E5E5E5] hover:border-[#FF8C00] transition-all flex items-center justify-between group shadow-sm hover:shadow-md"
                  >
                    <div className="flex items-center gap-4">
                      <Avatar src={`https://ui-avatars.com/api/?name=${encodeURIComponent(contact.name)}&background=random&color=fff`} size={56} />
                      <div>
                        <h3 className="font-bold text-lg text-[#0A0A0A]">{contact.name}</h3>
                        <p className="text-[#999] font-mono text-sm">{contact.address ? `${contact.address.slice(0, 10)}...${contact.address.slice(-5)}` : 'No Address'}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        aria-label="View profile"
                        onClick={() => onViewProfile && onViewProfile(contact)}
                        className="p-3 bg-[#F5F5F5] rounded-xl text-[#0A0A0A] hover:bg-[#E5E5E5] transition-colors"
                      >
                         <Info size={20} className="opacity-50" />
                      </button>
                      {onEditContact && (
                        <button
                          aria-label="Edit contact"
                          onClick={() => { setEditingId(contact.id); setEditName(contact.name); }}
                          className="p-3 bg-[#F5F5F5] rounded-xl text-[#0A0A0A] hover:bg-[#E5E5E5] transition-colors"
                        >
                          <Pencil size={20} className="opacity-50" />
                        </button>
                      )}
                      {onDeleteContact && (
                        <button
                          aria-label="Delete contact"
                          onClick={() => setDeletingId(contact.id)}
                          className="p-3 bg-[#F5F5F5] rounded-xl text-[#0A0A0A] hover:bg-red-100 hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={20} className="opacity-50" />
                        </button>
                      )}
                      <button
                        aria-label="Send message"
                        onClick={() => onSelectContact(contact.id)}
                        className="p-3 bg-[#F5F5F5] rounded-xl text-[#0A0A0A] hover:bg-[#FF8C00] transition-colors"
                      >
                        <MessageSquare size={20} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Network Search Results Section */}
        {searchQuery.length > 2 && (
          <div>
            <h3 className="text-sm font-bold text-[#666] uppercase tracking-wider mb-4 flex items-center gap-2">
              <Globe size={14} />
              Network Discovery
            </h3>
            
            {isSearchingNetwork ? (
               <div className="space-y-4">
                 <ContactSkeleton />
                 <ContactSkeleton />
               </div>
            ) : (
               <div className="space-y-4">
                 {/* Direct Add Option */}
                 {showDirectAdd && (
                    <div 
                      className="bg-white p-4 rounded-2xl border border-[#E5E5E5] hover:border-[#FF8C00] transition-all flex items-center justify-between group shadow-sm hover:shadow-md"
                    >
                      <div className="flex items-center gap-4">
                        <Avatar src={`https://ui-avatars.com/api/?name=${encodeURIComponent('Unknown')}&background=random&color=fff`} size={56} />
                        <div>
                          <h3 className="font-bold text-lg text-[#0A0A0A]">Unknown User</h3>
                          <p className="text-[#666] text-sm">Direct Address Match</p>
                          <p className="text-[#777] font-mono text-xs mt-1">{searchQuery.slice(0, 10)}...{searchQuery.slice(-5)}</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => {
                          // Open manual add modal with pre-filled address
                          setNewAddress(searchQuery);
                          setNewName(''); 
                          setIsAdding(true);
                        }}
                        className="bg-[#0A0A0A] text-white p-3 rounded-xl hover:bg-[#FF8C00] hover:text-black transition-colors"
                      >
                        <UserPlus size={20} />
                      </button>
                    </div>
                 )}

                 {/* Network Results */}
                 {networkResults.map((profile: NetworkProfile) => {
                  const added = isContactAdded(profile.address);
                  if (filteredContacts.some(c => c.address === profile.address)) return null;

                  return (
                  <div 
                    key={profile.address}
                    className="bg-white p-4 rounded-2xl border border-[#E5E5E5] hover:border-[#FF8C00] transition-all flex items-center justify-between group shadow-sm hover:shadow-md"
                  >
                    <div className="flex items-center gap-4">
                      <Avatar src={`https://ui-avatars.com/api/?name=${encodeURIComponent(profile.username || 'U')}&background=random&color=fff`} size={56} />
                      <div>
                        <h3 className="font-bold text-lg text-[#0A0A0A]">{profile.username || 'Unknown Name'}</h3>
                        <p className="text-[#666] text-sm">{profile.bio || 'No bio available'}</p>
                        <p className="text-[#999] font-mono text-xs mt-1">{profile.address.slice(0, 10)}...</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {onViewProfile && (
                        <button
                          onClick={() => onViewProfile(profile)}
                          className="p-3 bg-[#F5F5F5] rounded-xl text-[#0A0A0A] hover:bg-[#E5E5E5] transition-colors"
                          title="View Profile"
                        >
                          <Info size={20} />
                        </button>
                      )}
                      <button 
                        onClick={() => {
                          if (!added) {
                            onAddContact(profile.address, profile.username);
                            toast.success(`Contact ${profile.username} added`);
                          }
                        }}
                        disabled={added}
                        className={`p-3 rounded-xl transition-colors ${
                            added 
                            ? 'bg-[#E5E5E5] text-[#999] cursor-default' 
                            : 'bg-[#0A0A0A] text-white hover:bg-[#FF8C00] hover:text-black'
                        }`}
                      >
                        {added ? <Check size={20} /> : <Plus size={20} />}
                      </button>
                    </div>
                  </div>
                 );
                })}

                {/* Empty State */}
                {!showDirectAdd && networkResults.length === 0 && (
                   <p className="text-[#666] italic">No users found on the network.</p>
                )}
               </div>
            )}
          </div>
        )}

        {/* Empty State when no contacts and no search */}
        {contacts.length === 0 && !searchQuery && (
            <EmptyState 
              icon={UserX} 
              title="No contacts yet" 
              description="Start typing above to search the network and find people."
            />
        )}

      </div>

      {/* Edit Contact Modal */}
      {editingId && onEditContact && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E5E5E5] rounded-3xl p-8 w-full max-w-md shadow-2xl animate-scale-in relative">
            <button
              onClick={() => setEditingId(null)}
              className="absolute top-4 right-4 p-2 hover:bg-[#F5F5F5] rounded-full transition-colors"
            >
              <X size={20} />
            </button>

            <h3 className="text-2xl font-bold mb-6 text-[#0A0A0A]">Edit Contact</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#666] mb-2">Display Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && editName.trim()) {
                      onEditContact(editingId, editName.trim());
                      setEditingId(null);
                    }
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  className="w-full bg-[#F5F5F5] text-[#0A0A0A] rounded-xl p-4 font-bold focus:outline-none focus:ring-2 focus:ring-[#FF8C00] placeholder-[#999]"
                  placeholder="e.g. Satoshi"
                />
              </div>

              <button
                onClick={() => {
                  if (editName.trim()) {
                    onEditContact(editingId, editName.trim());
                    setEditingId(null);
                  } else {
                    toast.error('Name cannot be empty');
                  }
                }}
                disabled={!editName.trim()}
                className="w-full bg-[#0A0A0A] text-white py-4 rounded-xl font-bold hover:bg-[#FF8C00] hover:text-black transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-4"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingId && onDeleteContact && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E5E5E5] rounded-3xl p-8 w-full max-w-sm shadow-2xl animate-scale-in">
            <h3 className="text-xl font-bold mb-2 text-[#0A0A0A]">Delete Contact</h3>
            <p className="text-[#666] mb-6">
              Are you sure you want to delete <span className="font-bold text-[#0A0A0A]">{contacts.find(c => c.id === deletingId)?.name}</span>? This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  onDeleteContact(deletingId);
                  setDeletingId(null);
                }}
                className="flex-1 py-3 bg-red-500 text-white font-bold rounded-xl hover:bg-red-600 transition-colors"
              >
                Delete
              </button>
              <button
                onClick={() => setDeletingId(null)}
                className="flex-1 py-3 bg-[#F5F5F5] text-[#0A0A0A] font-bold rounded-xl hover:bg-[#E5E5E5] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Contact Modal */}
      {isAdding && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E5E5E5] rounded-3xl p-8 w-full max-w-md shadow-2xl animate-scale-in relative">
            <button 
              onClick={() => setIsAdding(false)}
              className="absolute top-4 right-4 p-2 hover:bg-[#F5F5F5] rounded-full transition-colors"
            >
              <X size={20} />
            </button>
            
            <h3 className="text-2xl font-bold mb-6 text-[#0A0A0A]">Add New Contact</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#666] mb-2">Display Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full bg-[#F5F5F5] text-[#0A0A0A] rounded-xl p-4 font-bold focus:outline-none focus:ring-2 focus:ring-[#FF8C00] placeholder-[#999]"
                  placeholder="e.g. Satoshi"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#666] mb-2">Wallet Address</label>
                <input
                  type="text"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  className="w-full bg-[#F5F5F5] rounded-xl p-4 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#FF8C00]"
                  placeholder="aleo1..."
                />
              </div>
              
              <button
                onClick={handleAdd}
                disabled={!newName || !newAddress}
                className="w-full bg-[#0A0A0A] text-white py-4 rounded-xl font-bold hover:bg-[#FF8C00] hover:text-black transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-4"
              >
                Save Contact
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ContactsView;
