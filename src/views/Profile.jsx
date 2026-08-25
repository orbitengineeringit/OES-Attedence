import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { apiCall } from '../services/api.js';
import { motion } from 'framer-motion';
import { Activity, Calendar, Mail, Shield, Building2, MapPin, Clock, Camera, Trash2, ShieldCheck, RefreshCw, UploadCloud, AlertCircle, CheckCircle2 } from 'lucide-react';
import { UserAvatar, StatusBadge, EmptyState, SkeletonTable } from '../components/common/CommonUI.jsx';
import { sanitizeAndCompressAvatar } from '../utils/imageSecurity.js';

const formatTimeStr = (t) => {
  if (!t) return '---';
  if (typeof t === 'string' && t.includes(':') && !t.includes('T') && !t.includes('-')) return t;
  try {
    const d = new Date(t);
    if (isNaN(d.getTime())) return t;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return t;
  }
};

export default function Profile() {
  const { user, updateUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const [avatarSuccess, setAvatarSuccess] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!user) return;
    let isMounted = true;
    const fetchProfileData = async () => {
      try {
        if (isMounted) setLoading(true);
        const profRes = await apiCall(`/employees/${user?.id}`, 'GET');
        if (profRes.success && isMounted) setProfile(profRes.employee);

        const histRes = await apiCall(`/attendance/history/${user?.id}`, 'GET');
        if (histRes.success && isMounted) setHistory(histRes.history);
      } catch (err) {
        console.error('[PROFILE ERROR]: Failed fetching user metadata:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchProfileData();
    return () => { isMounted = false; };
  }, [user]);

  const handleAvatarFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setAvatarError('');
    setAvatarSuccess('');
    setUploading(true);

    try {
      // 1. Client-Side Security Pipeline: Magic Byte Verification + Decompression + Canvas Sanitization
      const sanitizedBase64 = await sanitizeAndCompressAvatar(file, 400);

      // 2. Persist to API/Database
      const res = await apiCall(`/employees/${user.id}/avatar`, 'POST', { avatar: sanitizedBase64 });

      if (res.success) {
        setProfile(prev => ({ ...prev, avatar: sanitizedBase64 }));
        if (updateUser) {
          updateUser({ avatar: sanitizedBase64 });
        }
        setAvatarSuccess('Profile photo updated securely!');
        setTimeout(() => setAvatarSuccess(''), 4000);
      } else {
        throw new Error(res.message || 'Failed updating profile photo.');
      }
    } catch (err) {
      console.error('[AVATAR UPLOAD ERROR]:', err);
      setAvatarError(err.message || 'Image upload failed. Please try a standard JPG, PNG, or WebP image under 3MB.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemoveAvatar = async () => {
    if (!user || !profile?.avatar) return;
    if (!confirm('Are you sure you want to remove your profile photo?')) return;

    setAvatarError('');
    setAvatarSuccess('');
    setUploading(true);

    try {
      const res = await apiCall(`/employees/${user.id}/avatar`, 'POST', { avatar: null });
      if (res.success) {
        setProfile(prev => ({ ...prev, avatar: null }));
        if (updateUser) {
          updateUser({ avatar: null });
        }
        setAvatarSuccess('Profile photo removed.');
        setTimeout(() => setAvatarSuccess(''), 4000);
      }
    } catch (err) {
      setAvatarError(err.message || 'Failed removing photo.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 12 }} 
      animate={{ opacity: 1, y: 0 }} 
      transition={{ duration: 0.35 }} 
      className="grid grid-cols-1 gap-6 lg:grid-cols-3"
    >
      {/* Profile Overview Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm flex flex-col justify-between">
        <div>
          {/* Avatar with Interactive Upload Trigger */}
          <div className="flex flex-col items-center text-center">
            <div className="relative group">
              <UserAvatar 
                name={profile?.name || user?.name} 
                avatar={profile?.avatar || user?.avatar} 
                size="2xl" 
                className="w-24 h-24 text-2xl shadow-sm border-2 border-indigo-100 ring-4 ring-slate-50 transition-transform group-hover:scale-102" 
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                title="Change profile photo"
                className="absolute bottom-0 right-0 p-2 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-md border-2 border-white transition-all cursor-pointer hover:scale-110 active:scale-95 disabled:opacity-50"
                aria-label="Upload photo"
              >
                {uploading ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Camera className="w-3.5 h-3.5" />
                )}
              </button>

              <input 
                ref={fileInputRef}
                type="file" 
                accept="image/jpeg,image/png,image/webp" 
                onChange={handleAvatarFileSelect} 
                className="hidden" 
              />
            </div>

            <h2 className="mt-4 text-base font-semibold text-slate-900">{profile?.name || user?.name}</h2>
            <p className="mt-0.5 text-xs text-slate-500">{profile?.id || user?.id}</p>

            {/* Quick Actions */}
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
              >
                <UploadCloud className="w-3.5 h-3.5 text-slate-500" />
                {uploading ? 'Processing...' : 'Upload photo'}
              </button>

              {profile?.avatar && (
                <button
                  type="button"
                  onClick={handleRemoveAvatar}
                  disabled={uploading}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-red-200 bg-red-50/50 hover:bg-red-50 text-red-600 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
                  title="Remove custom photo"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Remove
                </button>
              )}
            </div>

            {/* Alerts */}
            {avatarError && (
              <div className="mt-3 p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2 text-left">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                <span>{avatarError}</span>
              </div>
            )}

            {avatarSuccess && (
              <div className="mt-3 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2 text-left animate-fade-in">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                <span>{avatarSuccess}</span>
              </div>
            )}
          </div>

          <div className="mt-6 space-y-3 border-t border-slate-100 pt-5 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-slate-500"><Mail className="h-3.5 w-3.5 text-slate-400" />Email</span>
              <span className="truncate font-medium text-slate-900">{profile?.email}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-slate-500"><Building2 className="h-3.5 w-3.5 text-slate-400" />Department</span>
              <span className="font-medium text-slate-900">{profile?.department}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-slate-500"><Shield className="h-3.5 w-3.5 text-slate-400" />Role</span>
              <span className="ui-badge badge-accent capitalize">{profile?.role || user?.role}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-slate-500"><MapPin className="h-3.5 w-3.5 text-slate-400" />Status</span>
              <span className={`ui-badge ${profile?.status === 'Inside Office' ? 'badge-success' : 'badge-neutral'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${profile?.status === 'Inside Office' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                {profile?.status || 'Offline'}
              </span>
            </div>
          </div>
        </div>

        {/* Security Assurance Badge */}
        <div className="mt-5 pt-3 border-t border-slate-100 flex items-center gap-2 text-[11px] text-slate-500">
          <ShieldCheck className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
          <span>Canvas sanitized · Zero EXIF / script payloads</span>
        </div>
      </div>

      {/* Attendance History */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden lg:col-span-2">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-2 text-indigo-600">
              <Activity className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Attendance history</h3>
              <p className="text-xs text-slate-500">Personal check-in and check-out records</p>
            </div>
          </div>
          <span className="ui-badge badge-neutral">{history.length} records</span>
        </div>

        {loading ? (
          <SkeletonTable rows={5} cols={5} />
        ) : history.length === 0 ? (
          <EmptyState
            icon={Calendar}
            title="No attendance records"
            description="Your scanned attendance records will appear here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-slate-500 font-medium">
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Check-in</th>
                  <th className="px-5 py-3">Check-out</th>
                  <th className="px-5 py-3">Working hours</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {history.map((rec) => (
                  <tr key={rec.id} className="transition-colors hover:bg-slate-50/70">
                    <td className="px-5 py-3.5 font-medium text-slate-900">{rec.date}</td>
                    <td className="px-5 py-3.5 text-slate-600">{formatTimeStr(rec.check_in)}</td>
                    <td className="px-5 py-3.5 text-slate-600">{formatTimeStr(rec.check_out)}</td>
                    <td className="px-5 py-3.5 font-medium text-slate-900">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-slate-400" />
                        {(rec.working_hours !== null && rec.working_hours !== undefined) ? Number(rec.working_hours).toFixed(2) : '0.00'}h
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`ui-badge ${
                        rec.status === 'On Time' ? 'badge-success' :
                        rec.status === 'Late Arrival' ? 'badge-warning' :
                        rec.status === 'Early Exit' ? 'badge-error' :
                        'badge-neutral'
                      }`}>
                        {rec.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  );
}
