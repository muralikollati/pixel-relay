import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/',
  withCredentials: true,
});

api.interceptors.request.use(config => {
  const token = localStorage.getItem('pr_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401 && localStorage.getItem('pr_token')) {
      const deleted = err.response?.data?.deleted;
      localStorage.removeItem('pr_token');
      localStorage.removeItem('pr_user');
      window.location.href = deleted ? '/?reason=deleted' : '/';
    }
    return Promise.reject(err);
  }
);

// ── Auth ───────────────────────────────────────────────────────────────────────
export const login = (username, password) => api.post('/users/login', { username, password });
export const getMe = ()                   => api.get('/users/me');

// FIX: Logout now calls the server to revoke the token before clearing local state.
// Previously this was purely client-side, meaning stolen tokens remained valid for 7 days.
export const logoutApi = () => api.post('/users/logout').catch(() => {});

// ── Users (superadmin) ─────────────────────────────────────────────────────────
export const getUsers          = ()                   => api.get('/users');
export const createUser        = (data)               => api.post('/users', data);
export const deleteUser        = (username)           => api.delete(`/users/${username}`);
export const updateUserRole    = (username, role)     => api.patch(`/users/${username}/role`, { role });
export const resetPassword     = (username, password) => api.patch(`/users/${username}/password`, { password });
export const getPermissions    = ()                   => api.get('/users/permissions');
export const updatePermissions = (role, perms)        => api.patch(`/users/permissions/${role}`, { permissions: perms });

// ── Gmail accounts ─────────────────────────────────────────────────────────────
export const getStats    = ()      => api.get('/worker/stats');
export const getAccounts = ()      => api.get('/auth/accounts');
export const connectGmail = async () => {
  const res = await api.post('/auth/google/init');
  window.location.href = res.data.url;
};
export const removeAccount = (email) => api.delete(`/auth/accounts/${encodeURIComponent(email)}`);
export const pauseAccount  = (email) => api.patch(`/auth/accounts/${encodeURIComponent(email)}/status`, { status: 'paused' });
export const resumeAccount = (email) => api.patch(`/auth/accounts/${encodeURIComponent(email)}/status`, { status: 'active' });

// ── Account Requests ───────────────────────────────────────────────────────────
export const getAccountRequests     = ()            => api.get('/account-requests');
export const approveRequest         = (email)       => api.post(`/account-requests/${encodeURIComponent(email)}/approve`);
export const rejectRequest          = (email, reason) => api.post(`/account-requests/${encodeURIComponent(email)}/reject`, { reason });
export const approveAllRequests     = ()            => api.post('/account-requests/approve-all');
export const approveUserRequests    = (username)    => api.post(`/account-requests/approve-user/${username}`);
export const deleteAccountRequest   = (email)       => api.delete(`/account-requests/${encodeURIComponent(email)}`);
export const reRequestAccount       = (email)       => api.post(`/account-requests/${encodeURIComponent(email)}/re-request`);

// ── Run History ───────────────────────────────────────────────────────────────
export const getRunHistory = (email, limit = 100) =>
  api.get(`/worker/run-history${email ? `?email=${encodeURIComponent(email)}&limit=${limit}` : `?limit=${limit}`}`);

// ── Reports ────────────────────────────────────────────────────────────────────
export const getReports     = (days = 7) => api.get(`/reports?days=${days}`);

// ── Worker config ──────────────────────────────────────────────────────────────
export const getWorkerConfig   = ()       => api.get('/worker/config');
export const patchWorkerConfig = (patch)  => api.patch('/worker/config', patch);

// ── Worker activity ────────────────────────────────────────────────────────────
export const postActivity   = (payload) => api.post('/worker/activity', payload);
export const getActivity    = ()        => api.get('/worker/activity');

export const healthCheck = () => api.get('/health');

export default api;

// ── Admin stop signals ─────────────────────────────────────────────────────────
export const requestStop    = (targetUser, email) => api.post('/worker/stop-request', { targetUser, email });