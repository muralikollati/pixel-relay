/**
 * Google OAuth2 Service
 * Handles: auth URL generation, code exchange, token refresh, Gmail client creation
 */

const { google } = require('googleapis');
require('dotenv').config();

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

/**
 * Generate the Google OAuth consent URL.
 * access_type=offline ensures we get a refresh_token.
 */
/**
 * Generate the Google OAuth consent URL.
 * state param carries the username so the callback can assign ownership
 * without relying on a cookie (works across browsers / incognito).
 */
function getAuthUrl(statePayload) {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type:            'offline',
    scope:                  SCOPES,
    prompt:                 'consent',
    include_granted_scopes: true,
    state:                  statePayload || '',
  });
}

/**
 * Exchange an authorization code for tokens.
 * Returns: { access_token, refresh_token, expiry_date, token_type, scope }
 */
async function exchangeCode(code) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  // Fetch the Gmail address linked to this token
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const { data } = await oauth2.userinfo.get();

  return {
    ...tokens,
    email:        data.email,
    displayName:  data.name,
    picture:      data.picture,
  };
}

/**
 * Create an authenticated Gmail API client for a stored account.
 * Automatically refreshes the access token if expired.
 */
async function getGmailClient(tokenData, onRefresh) {
  const client = createOAuthClient();
  client.setCredentials({
    access_token:  tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expiry_date:   tokenData.expiry_date,
  });

  // Auto-refresh listener — persists new token back to store
  client.on('tokens', (newTokens) => {
    if (onRefresh) onRefresh(newTokens);
  });

  return google.gmail({ version: 'v1', auth: client });
}

/**
 * Manually refresh an access token using its refresh_token.
 */
async function refreshToken(refreshToken) {
  const client = createOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await client.refreshAccessToken();
  return credentials;
}

module.exports = { getAuthUrl, exchangeCode, getGmailClient, refreshToken, createOAuthClient };
