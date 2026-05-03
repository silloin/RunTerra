import React, { useContext, useState, useEffect } from 'react';
import { AuthContext } from '../context/AuthContext';
import { motion } from 'framer-motion';
import { User, MapPin, Award, Shield, Zap, Target, Edit2, Save, X, Camera, Phone, Mail, Trash2, Plus, LogOut } from 'lucide-react';
import SOSButton from '../components/SOSButton';
import axios from 'axios';
import { useTranslation } from 'react-i18next';

const Profile = () => {
  const { t } = useTranslation();
  const { user, loading: authLoading, logout, updateProfile, updateProfilePhoto, uploadProfilePhoto } = useContext(AuthContext);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    username: '',
    city: ''
  });
  const [photoUrl, setPhotoUrl] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [isUpdatingPhoto, setIsUpdatingPhoto] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [imageError, setImageError] = useState(false);
  const fileInputRef = React.useRef(null);

  // Emergency Contacts State
  const [emergencyContacts, setEmergencyContacts] = useState([]);
  const [isAddingContact, setIsAddingContact] = useState(false);
  const [editingContactId, setEditingContactId] = useState(null);
  const [newContact, setNewContact] = useState({
    contactName: '',
    phoneNumber: '',
    email: '',
    contactType: 'friend'
  });

  // Sync editData with user context when user loads (hydration fix)
  useEffect(() => {
    if (user) {
      setEditData({
        username: user.username || '',
        city: user.city || ''
      });
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      fetchEmergencyContacts();
    }
  }, [user]);

  const fetchEmergencyContacts = async () => {
    try {
      const res = await axios.get('/emergency/contacts');
      setEmergencyContacts(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error('Error fetching emergency contacts:', err);
      setEmergencyContacts([]);
    }
  };

  const handleAddContact = async (e) => {
    e.preventDefault();
    
    // Client-side validation
    if (!newContact.contactName || !newContact.phoneNumber || !newContact.email) {
      setError('Please fill in all required fields: Name, Phone, and Email');
      return;
    }
    
    setLoading(true);
    try {
      await axios.post('/emergency/contacts', newContact);
      setNewContact({ contactName: '', phoneNumber: '', email: '', contactType: 'friend' });
      setIsAddingContact(false);
      fetchEmergencyContacts();
      setSuccess('Emergency contact added successfully! 🛡️');
    } catch (err) {
      setError('Failed to add emergency contact');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateContact = async (e) => {
    e.preventDefault();
    
    // Client-side validation
    if (!newContact.contactName || !newContact.phoneNumber || !newContact.email) {
      setError('Please fill in all required fields: Name, Phone, and Email');
      return;
    }
    
    setLoading(true);
    try {
      await axios.put(`/emergency/contacts/${editingContactId}`, newContact);
      setNewContact({ contactName: '', phoneNumber: '', email: '', contactType: 'friend' });
      setEditingContactId(null);
      setIsAddingContact(false);
      fetchEmergencyContacts();
      setSuccess('Emergency contact updated successfully! 🛡️');
    } catch (err) {
      setError('Failed to update emergency contact');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteContact = async (id) => {
    if (!window.confirm('Are you sure you want to delete this contact?')) return;
    try {
      await axios.delete(`/emergency/contacts/${id}`);
      fetchEmergencyContacts();
      setSuccess('Contact removed successfully');
    } catch (err) {
      setError('Failed to delete contact');
    }
  };

  const startEditingContact = (contact) => {
    setEditingContactId(contact.id);
    setNewContact({
      contactName: contact.contact_name,
      phoneNumber: contact.phone_number,
      email: contact.email || '',
      contactType: contact.contact_type || 'friend'
    });
    setIsAddingContact(true);
  };

  const handleEditClick = () => {
    setEditData({
      username: user?.username || '',
      city: user?.city || ''
    });
    setIsEditing(true);
    setError('');
    setSuccess('');
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditData({ username: user?.username || '', city: user?.city || '' });
    setError('');
  };

  const handleSaveProfile = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    
    try {
      await updateProfile(editData);
      setSuccess('Profile updated successfully! 🎉');
      setIsEditing(false);
    } catch (err) {
      setError(err.response?.data?.msg || 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  const handlePhotoUpdate = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    
    try {
      // If a file is selected, upload it
      if (selectedFile) {
        const result = await uploadProfilePhoto(selectedFile);
        console.log('✅ Photo uploaded successfully:', result.profilePhotoUrl);
        setSuccess('Profile photo uploaded successfully! 📸');
      } else if (photoUrl.trim()) {
        // Otherwise use URL
        const result = await updateProfilePhoto(photoUrl);
        console.log('✅ Photo URL updated successfully:', result.profilePhotoUrl);
        setSuccess('Profile photo updated successfully! 📸');
      } else {
        setError('Please select a file or enter a URL');
        return;
      }
      
      setPhotoUrl('');
      setSelectedFile(null);
      setIsUpdatingPhoto(false);
    } catch (err) {
      console.error('❌ Photo update error:', err);
      setError(err.response?.data?.msg || 'Failed to update photo');
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      // Validate file type
      const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
      if (!validTypes.includes(file.type)) {
        setError('Please select a valid image file (JPEG, PNG, GIF, WebP)');
        return;
      }
      
      // Validate file size (5MB)
      if (file.size > 5 * 1024 * 1024) {
        setError('File size must be less than 5MB');
        return;
      }
      
      setSelectedFile(file);
      setPhotoUrl(''); // Clear URL if file is selected
      setError('');
    }
  };

  const calculateLevelProgress = () => {
    const currentLevel = user?.level || 1;
    const xpForCurrentLevel = Math.pow(currentLevel, 2) * 100;
    const xpForNextLevel = Math.pow(currentLevel + 1, 2) * 100;
    const progress = ((user?.xp - xpForCurrentLevel) / (xpForNextLevel - xpForCurrentLevel)) * 100;
    return Math.min(Math.max(progress, 0), 100);
  };

  const badges = [
    { name: 'Pioneer', icon: Zap, description: 'First 50 tiles captured', achieved: (user?.total_tiles || 0) >= 50 },
    { name: 'City King', icon: Shield, description: 'Become a King of a zone', achieved: false },
    { name: 'Marathoner', icon: Target, description: 'Total distance > 42.2km', achieved: (user?.total_distance || 0) >= 42.2 },
    { name: 'Explorer', icon: Award, description: 'Capture tiles in 3 different cities', achieved: false },
  ];

  // Loading state while auth is initializing or user data is not available
  if (authLoading || !user) {
    return (
      <div className="p-4 sm:p-8 pb-24 sm:pb-8 bg-gray-900 min-h-screen text-white flex items-center justify-center">
        <div className="animate-pulse text-center">
          <div className="w-24 h-24 bg-gray-700 rounded-full mx-auto mb-4"></div>
          <div className="h-6 bg-gray-700 rounded w-48 mx-auto mb-2"></div>
          <div className="h-4 bg-gray-700 rounded w-32 mx-auto"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 pb-24 sm:pb-8 bg-gray-900 min-h-screen text-white">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-4xl mx-auto"
      >
        {/* Logout Button - Top Right */}
        <div className="flex justify-end mb-4">
          <button
            onClick={logout}
            className="flex items-center gap-2 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-500 rounded-lg transition border border-red-500/30"
          >
            <LogOut size={18} />
            <span className="font-semibold">Logout</span>
          </button>
        </div>

        {/* Profile Header */}
        <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl p-4 sm:p-8 mb-6 sm:mb-8 flex flex-col md:flex-row items-center shadow-2xl border border-red-500/30 relative">
          {/* Profile Photo */}
          <div className="relative mb-4 sm:mb-0 md:mr-8">
            {user?.profile_picture && !imageError ? (
              <div className="relative">
                <img 
                  src={user.profile_picture} 
                  alt={user.username}
                  className="w-24 sm:w-32 h-24 sm:h-32 rounded-full object-cover border-4 border-orange-500/50 shadow-lg"
                  onError={() => {
                    console.error('❌ Image failed to load:', user.profile_picture);
                    setImageError(true);
                  }}
                  onLoad={() => {
                    console.log('✅ Image loaded successfully:', user.profile_picture);
                    setImageError(false);
                  }}
                />
                <button
                  onClick={() => setIsUpdatingPhoto(!isUpdatingPhoto)}
                  className="absolute bottom-0 right-0 bg-gradient-to-r from-red-600 to-orange-600 p-2 rounded-full hover:from-red-700 hover:to-orange-700 transition shadow-lg"
                >
                  <Camera size={16} />
                </button>
              </div>
            ) : (
              <div className="relative">
                <div className="w-24 sm:w-32 h-24 sm:h-32 bg-gradient-to-br from-red-500 to-orange-500 rounded-full flex items-center justify-center text-3xl sm:text-5xl font-bold border-4 border-orange-500/50 shadow-lg">
                  {user?.username?.[0]?.toUpperCase() || '?'}
                </div>
                <button
                  onClick={() => setIsUpdatingPhoto(!isUpdatingPhoto)}
                  className="absolute bottom-0 right-0 bg-gradient-to-r from-red-600 to-orange-600 p-2 rounded-full hover:from-red-700 hover:to-orange-700 transition shadow-lg"
                >
                  <Camera size={16} />
                </button>
              </div>
            )}
          </div>

          {/* Profile Info */}
          <div className="text-center md:text-left flex-1">
            <div className="flex items-center justify-center md:justify-start gap-3 mb-2">
              <h1 className="text-2xl sm:text-4xl font-bold">
                {isEditing ? (
                  <input
                    type="text"
                    value={editData.username}
                    onChange={(e) => setEditData({ ...editData, username: e.target.value })}
                    className="bg-gray-700 px-3 py-2 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                ) : (
                  user?.username || 'Loading...'
                )}
              </h1>
              {!isEditing && (
                <button
                  onClick={handleEditClick}
                  className="bg-gray-700 p-2 rounded-lg hover:bg-gray-600 transition"
                >
                  <Edit2 size={16} />
                </button>
              )}
            </div>
            
            <div className="flex items-center justify-center md:justify-start text-gray-400 mb-4">
              <MapPin size={16} className="mr-2 text-red-500" />
              {isEditing ? (
                <input
                  type="text"
                  value={editData.city}
                  onChange={(e) => setEditData({ ...editData, city: e.target.value })}
                  placeholder="Enter your city"
                  className="bg-gray-700 px-3 py-1 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              ) : (
                <span className="text-sm sm:text-base">{user?.city || 'Unknown City'}</span>
              )}
            </div>

            {/* Level and XP Progress */}
            <div className="mb-4">
              <div className="flex items-center justify-center md:justify-start gap-2 mb-2">
                <Award className="text-yellow-500" size={20} />
                <span className="text-lg font-bold">Level {user?.level || 1}</span>
              </div>
              <div className="w-full max-w-md bg-gray-700 rounded-full h-3 overflow-hidden">
                <div 
                  className="bg-gradient-to-r from-blue-600 to-purple-600 h-full transition-all duration-500"
                  style={{ width: `${calculateLevelProgress()}%` }}
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">
                XP: {user?.xp || 0} / {Math.pow((user?.level || 1) + 1, 2) * 100}
              </p>
            </div>

            {/* Action Buttons */}
            {isEditing && (
              <div className="flex gap-3 justify-center md:justify-start mt-4">
                <button
                  onClick={handleSaveProfile}
                  disabled={loading}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 px-4 py-2 rounded-lg transition flex items-center gap-2"
                >
                  <Save size={16} />
                  {loading ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={handleCancelEdit}
                  disabled={loading}
                  className="bg-gray-600 hover:bg-gray-700 disabled:bg-gray-700 px-4 py-2 rounded-lg transition flex items-center gap-2"
                >
                  <X size={16} />
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Photo Upload Modal */}
        {isUpdatingPhoto && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-xl p-6 max-w-md w-full">
              <h3 className="text-xl font-bold mb-4">Update Profile Photo</h3>
              
              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4">
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}
              
              {/* File Upload Option */}
              <div className="mb-4">
                <label className="block text-sm font-bold text-gray-300 mb-2">
                  Upload from Device
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                  onChange={handleFileChange}
                  className="w-full bg-gray-700 px-4 py-2 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-600 mb-2"
                />
                {selectedFile && (
                  <p className="text-sm text-green-400 flex items-center gap-2">
                    ✓ Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                  </p>
                )}
              </div>
              
              <div className="text-center text-gray-500 text-sm mb-4">— OR —</div>
              
              {/* URL Input Option */}
              <div className="mb-4">
                <label className="block text-sm font-bold text-gray-300 mb-2">
                  Image URL
                </label>
                <input
                  type="url"
                  value={photoUrl}
                  onChange={(e) => {
                    setPhotoUrl(e.target.value);
                    setSelectedFile(null); // Clear file if URL is entered
                  }}
                  placeholder="Paste image URL here..."
                  className="w-full bg-gray-700 px-4 py-2 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              
              <div className="flex gap-3">
                <button
                  onClick={handlePhotoUpdate}
                  disabled={loading || (!selectedFile && !photoUrl.trim())}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 px-4 py-2 rounded-lg transition"
                >
                  {loading ? 'Updating...' : selectedFile ? 'Upload Photo' : 'Update Photo'}
                </button>
                <button
                  onClick={() => {
                    setIsUpdatingPhoto(false);
                    setPhotoUrl('');
                    setSelectedFile(null);
                    setError('');
                  }}
                  className="flex-1 bg-gray-600 hover:bg-gray-700 px-4 py-2 rounded-lg transition"
                >
                  Cancel
                </button>
              </div>
              
              <p className="text-xs text-gray-500 mt-3 text-center">
                Supported formats: JPEG, PNG, GIF, WebP (Max 5MB)
              </p>
            </div>
          </div>
        )}

        {/* Alerts */}
        {error && (
          <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-green-900/50 border border-green-500 text-green-200 px-4 py-3 rounded-lg mb-6">
            {success}
          </div>
        )}

        {/* Achievement Badges */}
        <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6 flex items-center justify-center md:justify-start">
          <Award className="mr-2 sm:mr-3 text-yellow-500" size={20} /> Achievement Badges
        </h2>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          {badges.map((badge) => {
            const Icon = badge.icon;
            return (
              <div key={badge.name} className={`p-4 sm:p-6 rounded-xl border transition flex items-center ${
                badge.achieved ? 'bg-blue-600/10 border-blue-500' : 'bg-gray-800/50 border-gray-700 grayscale opacity-50'
              }`}>
                <div className={`w-12 sm:w-16 h-12 sm:h-16 rounded-full flex items-center justify-center mr-4 sm:mr-6 ${
                  badge.achieved ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400'
                }`}>
                  <Icon size={24} />
                </div>
                <div className="text-left">
                  <h3 className="text-lg sm:text-xl font-bold">{badge.name}</h3>
                  <p className="text-gray-400 text-xs sm:text-sm">{badge.description}</p>
                  {badge.achieved && (
                    <span className="text-xs font-bold text-blue-400 uppercase mt-2 block">Unlocked</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Emergency Contacts Section */}
        <div className="bg-gray-800 rounded-2xl p-4 sm:p-8 mt-6 sm:mt-8 shadow-2xl border border-gray-700 mb-8">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl sm:text-2xl font-bold flex items-center">
              <Shield className="mr-2 sm:mr-3 text-red-500" size={24} /> Emergency Contacts
            </h2>
            <button 
              onClick={() => {
                if (isAddingContact) {
                  setIsAddingContact(false);
                  setEditingContactId(null);
                  setNewContact({ contactName: '', phoneNumber: '', email: '', contactType: 'friend' });
                } else {
                  setIsAddingContact(true);
                }
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition"
            >
              {isAddingContact ? <X size={16} /> : <Plus size={16} />}
              {isAddingContact ? 'Cancel' : t('profile.add_contact')}
            </button>
          </div>

          {isAddingContact && (
            <form onSubmit={editingContactId ? handleUpdateContact : handleAddContact} className="mb-8 p-4 bg-gray-900/50 rounded-xl border border-gray-700 space-y-4 animate-in fade-in slide-in-from-top-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">{t('sos.name')}</label>
                  <input 
                    placeholder="Contact Name"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-white focus:ring-2 focus:ring-blue-600 outline-none"
                    value={newContact.contactName}
                    onChange={(e) => setNewContact({...newContact, contactName: e.target.value})}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">{t('sos.phone')}</label>
                  <input 
                    placeholder="Phone Number"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-white focus:ring-2 focus:ring-blue-600 outline-none"
                    value={newContact.phoneNumber}
                    onChange={(e) => setNewContact({...newContact, phoneNumber: e.target.value})}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Email *</label>
                  <input 
                    placeholder="Email Address"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-white focus:ring-2 focus:ring-blue-600 outline-none"
                    value={newContact.email}
                    onChange={(e) => setNewContact({...newContact, email: e.target.value})}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">{t('profile.type')}</label>
                  <select
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-white focus:ring-2 focus:ring-blue-600 outline-none"
                    value={newContact.contactType}
                    onChange={(e) => setNewContact({...newContact, contactType: e.target.value})}
                  >
                    <option value="family">Family</option>
                    <option value="friend">Friend</option>
                    <option value="colleague">Colleague</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button 
                  type="button"
                  onClick={() => {
                    setIsAddingContact(false);
                    setEditingContactId(null);
                    setNewContact({ contactName: '', phoneNumber: '', email: '', contactType: 'friend' });
                  }}
                  className="bg-gray-700 hover:bg-gray-600 text-white px-6 py-2 rounded-lg font-bold transition"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={loading}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-2 rounded-lg font-bold shadow-lg transition disabled:opacity-50"
                >
                  {loading ? 'Processing...' : (editingContactId ? t('profile.update_contact') : t('profile.save_contact'))}
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {!Array.isArray(emergencyContacts) || emergencyContacts.length === 0 ? (
              <div className="col-span-2 text-center py-10 text-gray-500 italic bg-gray-900/30 rounded-xl border border-dashed border-gray-700">
                No emergency contacts added yet. Add contacts to be notified during SOS alerts.
              </div>
            ) : (
              emergencyContacts.map(contact => (
                <div key={contact.id} className="bg-gray-900 p-5 rounded-xl border border-gray-700 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 group hover:border-blue-500/50 transition">
                  <div className="space-y-2 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-bold text-lg text-gray-100 truncate">{contact.contact_name}</h4>
                      <span className="text-[10px] bg-gray-800 px-2 py-0.5 rounded text-blue-400 uppercase font-bold border border-gray-700 whitespace-nowrap">
                        {contact.contact_type}
                      </span>
                    </div>
                    <div className="flex items-center text-sm text-gray-400">
                      <Phone size={14} className="mr-2 text-blue-500 flex-shrink-0" />
                      <span className="truncate">{contact.phone_number}</span>
                    </div>
                    {contact.email && (
                      <div className="flex items-center text-sm text-gray-400">
                        <Mail size={14} className="mr-2 text-gray-500 flex-shrink-0" />
                        <span className="truncate">{contact.email}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 flex-shrink-0 self-end sm:self-center">
                    <button 
                      onClick={() => startEditingContact(contact)}
                      className="text-gray-400 hover:text-blue-500 p-2 rounded-lg hover:bg-blue-500/10 transition"
                      title="Edit contact"
                    >
                      <Edit2 size={18} />
                    </button>
                    <button 
                      onClick={() => handleDeleteContact(contact.id)}
                      className="text-gray-400 hover:text-red-500 p-2 rounded-lg hover:bg-red-500/10 transition"
                      title="Delete contact"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </motion.div>
      
      {/* SOS Emergency Button */}
      <SOSButton />
    </div>
  );
};

export default Profile;

