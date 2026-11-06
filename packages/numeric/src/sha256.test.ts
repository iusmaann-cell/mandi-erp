import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Sha256, sha256Hex, sha256Internals, utf8Bytes } from "./sha256";

// Reference digests produced by Python's hashlib over `n` bytes of "a" (computed outside this codebase).
const SHA_VECTORS: readonly (readonly [number, string])[] = [
  [0, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  [1, "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb"],
  [3, "9834876dcfb05cb167a5c24953eba58c4ac89b1adf57f28f2f9d09af107ee8f0"],
  [55, "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318"],
  [56, "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a"],
  [57, "f13b2d724659eb3bf47f2dd6af1accc87b81f09f59f2b75e5c0bed6589dfe8c6"],
  [63, "7d3e74a05d7db15bce4ad9ec0658ea98e3f06eeecf16b4c6fff2da457ddc2f34"],
  [64, "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb"],
  [65, "635361c48bb9eab14198e76ea8ab7f1a41685d6ad62aa9146d301d4f17eb0ae0"],
  [119, "31eba51c313a5c08226adf18d4a359cfdfd8d2e816b13f4af952f7ea6584dcfb"],
  [120, "2f3d335432c70b580af0e8e1b3674a7c020d683aa5f73aaaedfdc55af904c21c"],
  [128, "6836cf13bac400e9105071cd6af47084dfacad4e5e302c94bfed24e013afb73e"],
  [1000, "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3"],
  [1000000, "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"],
];

describe("SHA-256 (the N-3 digest hash)", () => {
  it.each(SHA_VECTORS)("matches the reference digest of %s bytes of 'a'", (length, expected) => {
    expect(sha256Hex(new Uint8Array(length).fill(97))).toBe(expected);
  });

  it("matches the published FIPS 180 test messages", () => {
    expect(sha256Hex(utf8Bytes("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex(utf8Bytes("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
    expect(sha256Hex(utf8Bytes("abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu"))).toBe("cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1");
  });

  it("gives the same digest however the input is split across updates (property)", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), fc.array(fc.integer({ min: 0, max: 130 }), { maxLength: 6 }), (data, cuts) => {
        const whole = sha256Hex(data);
        const sha = new Sha256();
        let at = 0;
        for (const cut of cuts) {
          sha.update(data.subarray(at, at + cut));
          at = Math.min(data.length, at + cut);
        }
        sha.update(data.subarray(at));
        return sha.hex() === whole;
      }),
    );
  });

  it("update returns the hasher so calls can be chained", () => {
    const sha = new Sha256();
    expect(sha.update(utf8Bytes("a"))).toBe(sha);
    expect(sha.update(utf8Bytes("bc")).hex()).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("the derived constants are the published ones", () => {
  const { isqrt, icbrt, firstPrimes, ROUND_CONSTANTS, INITIAL_STATE } = sha256Internals;
  const hex = (n: number | undefined): string => (n ?? 0).toString(16).padStart(8, "0");

  it("the first 64 primes", () => {
    const primes = firstPrimes(64);
    expect(primes).toHaveLength(64);
    expect(primes.slice(0, 10)).toEqual([2, 3, 5, 7, 11, 13, 17, 19, 23, 29]);
    expect(primes[63]).toBe(311);
    expect(firstPrimes(0)).toEqual([]);
    expect(firstPrimes(1)).toEqual([2]);
  });

  it("round constants (FIPS 180-4, 4.2.2): first, second and last", () => {
    expect(ROUND_CONSTANTS).toHaveLength(64);
    expect(hex(ROUND_CONSTANTS[0])).toBe("428a2f98");
    expect(hex(ROUND_CONSTANTS[1])).toBe("71374491");
    expect(hex(ROUND_CONSTANTS[63])).toBe("c67178f2");
  });

  it("starting state (FIPS 180-4, 5.3.3)", () => {
    expect(Array.from(INITIAL_STATE, hex)).toEqual(["6a09e667", "bb67ae85", "3c6ef372", "a54ff53a", "510e527f", "9b05688c", "1f83d9ab", "5be0cd19"]);
  });

  it("integer square roots, including the small cases", () => {
    for (const [n, root] of [[0n, 0n], [1n, 1n], [2n, 1n], [3n, 1n], [4n, 2n], [8n, 2n], [9n, 3n], [99n, 9n], [100n, 10n], [10n ** 40n, 10n ** 20n], [10n ** 40n - 1n, 10n ** 20n - 1n]] as const) {
      expect(isqrt(n)).toBe(root);
    }
  });

  it("integer cube roots, including the small cases", () => {
    for (const [n, root] of [[0n, 0n], [1n, 1n], [2n, 1n], [7n, 1n], [8n, 2n], [26n, 2n], [27n, 3n], [63n, 3n], [64n, 4n], [10n ** 30n, 10n ** 10n], [10n ** 30n - 1n, 10n ** 10n - 1n]] as const) {
      expect(icbrt(n)).toBe(root);
    }
  });
});

describe("utf8Bytes", () => {
  const bytes = (text: string) => Array.from(utf8Bytes(text));
  it("encodes one, two, three and four byte characters", () => {
    expect(bytes("A")).toEqual([0x41]);
    expect(bytes("\u007f")).toEqual([0x7f]);
    expect(bytes("\u0080")).toEqual([0xc2, 0x80]);
    expect(bytes("é")).toEqual([0xc3, 0xa9]);
    expect(bytes("\u07ff")).toEqual([0xdf, 0xbf]);
    expect(bytes("\u0800")).toEqual([0xe0, 0xa0, 0x80]);
    expect(bytes("۰")).toEqual([0xdb, 0xb0]);
    expect(bytes("€")).toEqual([0xe2, 0x82, 0xac]);
    expect(bytes("\uffff")).toEqual([0xef, 0xbf, 0xbf]);
    expect(bytes("\u{10000}")).toEqual([0xf0, 0x90, 0x80, 0x80]);
    expect(bytes("😀")).toEqual([0xf0, 0x9f, 0x98, 0x80]);
    expect(bytes("")).toEqual([]);
  });

  it("agrees with the host's own UTF-8 encoder on any text (property)", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 40 }), (text) => {
        const viaRef = Uint8Array.from(unescape(encodeURIComponent(text)), (c) => c.charCodeAt(0));
        // encodeURIComponent throws on lone surrogates; fast-check's "binary" unit never makes them
        return Array.from(utf8Bytes(text)).join() === Array.from(viaRef).join();
      }),
    );
  });
});
