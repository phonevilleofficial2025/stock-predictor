import { useState } from 'react';
import { api } from '../api.js';
import Card from '../components/Card.jsx';
import PageHeader from '../components/PageHeader.jsx';
import PrimaryButton from '../components/PrimaryButton.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';

export default function Settings({ username, onUsernameChanged }) {
  const confirm = useConfirm();
  const [newUsername, setNewUsername] = useState(username || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [busy, setBusy] = useState(false);

  const usernameChanged = newUsername.trim() !== '' && newUsername.trim() !== username;
  const passwordChanged = newPassword.length > 0;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!currentPassword) {
      setError('Enter your current password to make changes.');
      return;
    }
    if (!usernameChanged && !passwordChanged) {
      setError('Change the username and/or password before saving.');
      return;
    }
    if (passwordChanged && newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    if (passwordChanged && newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }

    const changes = [];
    if (usernameChanged) changes.push(`username to "${newUsername.trim()}"`);
    if (passwordChanged) changes.push('password');
    const ok = await confirm({
      title: 'Save account changes?',
      message: `Change your ${changes.join(' and ')}?`,
      confirmLabel: 'Save',
    });
    if (!ok) return;

    setBusy(true);
    try {
      const res = await api.updateAccount({
        currentPassword,
        newUsername: usernameChanged ? newUsername.trim() : undefined,
        newPassword: passwordChanged ? newPassword : undefined,
      });
      onUsernameChanged?.(res.username);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess('Account updated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader>Account Settings</PageHeader>
      <div className="py-8">
        <div className="max-w-xl mx-auto sm:px-6 lg:px-8 space-y-6">
          <Card>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Change your username and/or password. Your current password is required to confirm any change.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block font-medium text-sm text-gray-700 dark:text-gray-300 mb-1">Username</label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="w-full border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600"
                />
              </div>

              <div>
                <label className="block font-medium text-sm text-gray-700 dark:text-gray-300 mb-1">New Password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Leave blank to keep your current password"
                  className="w-full border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600"
                />
              </div>

              {passwordChanged && (
                <div>
                  <label className="block font-medium text-sm text-gray-700 dark:text-gray-300 mb-1">Confirm New Password</label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600"
                  />
                </div>
              )}

              <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
                <label className="block font-medium text-sm text-gray-700 dark:text-gray-300 mb-1 mt-4">Current Password *</label>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Required to save any change"
                  className="w-full border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600"
                />
              </div>

              {error && (
                <div className="bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 text-red-800 dark:text-red-200 px-3 py-2 rounded text-sm">
                  {error}
                </div>
              )}
              {success && (
                <div className="bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700 text-green-800 dark:text-green-200 px-3 py-2 rounded text-sm">
                  {success}
                </div>
              )}

              <PrimaryButton type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save Changes'}
              </PrimaryButton>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
