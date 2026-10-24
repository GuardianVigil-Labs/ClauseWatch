// Public keys this extension accepts rule updates from, keyed by `keyId` (the
// first 8 bytes of the key, base64url). Public by design: they only verify.
//
// The GuardianVigil team signs each rules release; the extension accepts only
// a release whose signature verifies against a key listed here
// (docs/reader.md#the-signed-release). A file signed with any other key is
// ignored, and the rules already in hand are kept.
export const TRUSTED_RULE_KEYS: Record<string, string> = {
  "dAntedQrp9w": "dAntedQrp9xGdLrkUKsH8FyHHWzVsh+ZCXOHfDHzvq8=",
};
