const blacklistedTokens = new Map();

const addToBlacklist = (token, exp) => {
  blacklistedTokens.set(token, exp);
};

const isBlacklisted = (token) => {
  const exp = blacklistedTokens.get(token);
  if (!exp) return false;

  if (Date.now() > exp * 1000) {
    blacklistedTokens.delete(token);
    return false;
  }

  return true;
};

module.exports = { isBlacklisted, addToBlacklist };
