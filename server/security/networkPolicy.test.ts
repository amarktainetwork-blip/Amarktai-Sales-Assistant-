import { describe, expect, it } from "vitest";
import { isPrivateAddress, isPrivateIpv4 } from "./networkPolicy";

describe("browser connector public-network policy", () => {
  it("blocks loopback, private, link-local, CGNAT and documentation IPv4 ranges", () => {
    for (const address of ["127.0.0.1", "10.2.3.4", "172.16.4.5", "192.168.1.2", "169.254.1.1", "100.64.1.1", "192.0.2.3", "198.51.100.4", "203.0.113.5"]) {
      expect(isPrivateIpv4(address)).toBe(true);
    }
    expect(isPrivateIpv4("8.8.8.8")).toBe(false);
  });

  it("blocks loopback, ULA, link-local, documentation and private IPv4-mapped IPv6", () => {
    for (const address of ["::1", "fd00::1", "fe80::1", "2001:db8::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
  });
});
