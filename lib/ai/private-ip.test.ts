import { describe, expect, it } from "vitest";
import { isPrivateIp, ipv4IsPrivate, ipv6IsPrivate } from "@/lib/ai/private-ip";

describe("ipv4IsPrivate", () => {
  it("flags loopback, unspecified, and metadata ranges", () => {
    expect(ipv4IsPrivate("127.0.0.1")).toBe(true);
    expect(ipv4IsPrivate("0.0.0.0")).toBe(true);
    expect(ipv4IsPrivate("169.254.169.254")).toBe(true); // cloud metadata
  });

  it("flags RFC 1918 and CGNAT ranges", () => {
    expect(ipv4IsPrivate("10.0.0.1")).toBe(true);
    expect(ipv4IsPrivate("172.16.0.1")).toBe(true);
    expect(ipv4IsPrivate("172.31.255.255")).toBe(true);
    expect(ipv4IsPrivate("192.168.1.1")).toBe(true);
    expect(ipv4IsPrivate("100.64.0.1")).toBe(true);
  });

  it("allows public addresses and respects the 172.16/12 boundary", () => {
    expect(ipv4IsPrivate("8.8.8.8")).toBe(false);
    expect(ipv4IsPrivate("172.15.0.1")).toBe(false); // just below the range
    expect(ipv4IsPrivate("172.32.0.1")).toBe(false); // just above the range
    expect(ipv4IsPrivate("100.63.0.1")).toBe(false); // just below CGNAT
    expect(ipv4IsPrivate("100.128.0.1")).toBe(false); // just above CGNAT
  });

  it("treats malformed input as unsafe", () => {
    expect(ipv4IsPrivate("999.1.1.1")).toBe(true);
    expect(ipv4IsPrivate("10.0.0")).toBe(true);
  });
});

describe("ipv6IsPrivate", () => {
  it("flags loopback, unspecified, link-local, and ULA", () => {
    expect(ipv6IsPrivate("::1")).toBe(true);
    expect(ipv6IsPrivate("::")).toBe(true);
    expect(ipv6IsPrivate("fe80::1")).toBe(true);
    expect(ipv6IsPrivate("fc00::1")).toBe(true);
    expect(ipv6IsPrivate("fd12:3456::1")).toBe(true);
  });

  it("resolves IPv4-mapped addresses through the IPv4 check", () => {
    expect(ipv6IsPrivate("::ffff:127.0.0.1")).toBe(true);
    expect(ipv6IsPrivate("::ffff:8.8.8.8")).toBe(false);
  });

  it("allows public IPv6", () => {
    expect(ipv6IsPrivate("2606:4700:4700::1111")).toBe(false);
  });
});

describe("isPrivateIp", () => {
  it("dispatches by family and rejects non-IP input", () => {
    expect(isPrivateIp("10.0.0.1")).toBe(true);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("fe80::1")).toBe(true);
    expect(isPrivateIp("example.com")).toBe(true); // not an IP → unsafe
    expect(isPrivateIp("")).toBe(true);
  });
});
