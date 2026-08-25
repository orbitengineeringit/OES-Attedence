import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext.jsx';
import { UserPlus, Mail, Key, User, ShieldCheck, AlertCircle, BadgeCheck } from 'lucide-react';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    id: '',
    name: '',
    email: '',
    password: '',
    role: 'employee',
    department: 'Engineering'
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    const res = await register(formData);
    if (res.success) {
      setSuccess('Profile created successfully. Redirecting...');
      setTimeout(() => navigate('/login'), 1500);
    } else {
      setError(res.message || 'Profile enrollment failed.');
      setLoading(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">New account</p>
        <h2 className="mt-1 text-2xl font-semibold text-slate-900">Create employee profile</h2>
        <p className="mt-1 text-sm text-slate-500">Add basic employee details before biometric enrollment.</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-100 bg-rose-50 p-3 text-sm text-rose-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-700">
          <ShieldCheck className="h-4 w-4 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Corporate ID</label>
          <div className="relative">
            <BadgeCheck className="absolute left-3.5 top-3.5 h-4 w-4 text-slate-400" />
            <input type="text" name="id" required placeholder="OES/038" value={formData.id} onChange={handleChange} className="w-full pl-10" />
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Full name</label>
          <div className="relative">
            <User className="absolute left-3.5 top-3.5 h-4 w-4 text-slate-400" />
            <input type="text" name="name" required placeholder="Employee name" value={formData.name} onChange={handleChange} className="w-full pl-10" />
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Corporate email</label>
          <div className="relative">
            <Mail className="absolute left-3.5 top-3.5 h-4 w-4 text-slate-400" />
            <input type="email" name="email" required placeholder="employee@company.com" value={formData.email} onChange={handleChange} className="w-full pl-10" />
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Password</label>
          <div className="relative">
            <Key className="absolute left-3.5 top-3.5 h-4 w-4 text-slate-400" />
            <input type="password" name="password" required placeholder="Minimum 6 characters" value={formData.password} onChange={handleChange} className="w-full pl-10" />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Role</label>
            <select name="role" value={formData.role} onChange={handleChange} className="w-full">
              <option value="employee">Employee</option>
              <option value="admin">Administrator</option>
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Department</label>
            <select name="department" value={formData.department} onChange={handleChange} className="w-full">
              <option value="Engineering">Engineering</option>
              <option value="Security & HR">Security & HR</option>
              <option value="Product">Product</option>
            </select>
          </div>
        </div>

        <button type="submit" disabled={loading} className="ui-button ui-button-primary w-full">
          <UserPlus className="h-4 w-4" />
          {loading ? 'Creating profile...' : 'Create profile'}
        </button>
      </form>

      <p className="text-center text-sm text-slate-500">
        Already registered? <Link to="/login" className="font-semibold text-indigo-600 hover:underline">Sign in</Link>
      </p>
    </motion.div>
  );
}
