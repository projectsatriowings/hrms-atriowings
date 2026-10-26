import { decryptBankDetails, encryptBankDetails, isEncryptedBankDetails } from "./bank-crypto";

process.env.BANK_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("bank-crypto (AES-256-GCM)", () => {
  it("encrypts to the enc:v1: format with no plaintext leakage", () => {
    const enc = encryptBankDetails({ accountNumber: "1234567890", ifsc: "SBIN0001234" });
    expect(isEncryptedBankDetails(enc)).toBe(true);
    expect(enc).toMatch(/^enc:v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(enc).not.toContain("1234567890");
    expect(enc).not.toContain("SBIN0001234");
  });

  it("round-trips and uses a fresh IV per encryption", () => {
    const value = { accountNumber: "1234567890", ifsc: "SBIN0001234" };
    const a = encryptBankDetails(value);
    const b = encryptBankDetails(value);
    expect(a).not.toBe(b);
    expect(decryptBankDetails(a)).toEqual(value);
    expect(decryptBankDetails(b)).toEqual(value);
  });

  it("passes legacy plaintext values through untouched (detection only)", () => {
    const plain = { accountNumber: "1234567890" };
    expect(isEncryptedBankDetails(plain)).toBe(false);
    expect(decryptBankDetails(plain)).toEqual(plain);
  });

  it("rejects tampered ciphertext", () => {
    const enc = encryptBankDetails({ accountNumber: "1234567890" });
    const parts = enc.split(":");
    parts[parts.length - 1] = Buffer.from("tampered").toString("base64");
    expect(() => decryptBankDetails(parts.join(":"))).toThrow();
  });
});
