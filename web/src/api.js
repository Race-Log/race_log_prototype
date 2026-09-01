const API_URL = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

async function request(path, options = {}) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let message = "Request failed";

    try {
      const body = await response.json();
      if (Array.isArray(body.detail)) {
        message = body.detail
          .map((item) => `${item.loc?.join(".") || "field"}: ${item.msg}`)
          .join("; ");
      } else {
        message = body.detail || message;
      }
    } catch {
      message = response.statusText || message;
    }

    throw new Error(message);
  }

  return response.json();
}

function withAuth(token) {
  return {
    Authorization: `Bearer ${token}`,
  };
}

function buildQuery(path, params = {}) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  });

  const queryString = query.toString();
  return queryString ? `${path}?${queryString}` : path;
}

export async function register(payload) {
  return request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function login(payload) {
  return request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getProfile(token) {
  return request("/api/users/me", {
    headers: withAuth(token),
  });
}

export async function searchUsers(token, query) {
  return request(buildQuery("/api/users/search", { q: query }), {
    headers: withAuth(token),
  });
}

export async function getReferenceData(token) {
  return request("/api/reference-data", {
    headers: withAuth(token),
  });
}

export async function getResults(token, userId) {
  return request(buildQuery("/api/results", { user_id: userId }), {
    headers: withAuth(token),
  });
}

export async function getRankHistory(token, userId) {
  return request(buildQuery("/api/rank-history", { user_id: userId }), {
    headers: withAuth(token),
  });
}

export async function createResult(token, payload) {
  return request("/api/results", {
    method: "POST",
    headers: withAuth(token),
    body: JSON.stringify(payload),
  });
}

export async function getGroups(token) {
  return request("/api/groups", {
    headers: withAuth(token),
  });
}

export async function createGroup(token, payload) {
  return request("/api/groups", {
    method: "POST",
    headers: withAuth(token),
    body: JSON.stringify(payload),
  });
}

export async function joinGroup(token, payload) {
  return request("/api/groups/join", {
    method: "POST",
    headers: withAuth(token),
    body: JSON.stringify(payload),
  });
}

export async function getGroupDetail(token, groupId) {
  return request(`/api/groups/${groupId}`, {
    headers: withAuth(token),
  });
}

export async function approveGroupMember(token, groupId, membershipId) {
  return request(`/api/groups/${groupId}/members/${membershipId}/approve`, {
    method: "POST",
    headers: withAuth(token),
  });
}
