import { describe, expect, it } from "vitest";
import {
  canManageGroupGame,
  formatPrice,
  manualGameSchema,
  normalizeGameName,
  sortLibrary,
  splitList,
} from "./rules";

const form = (over: Record<string, string> = {}) => ({
  name: "Battlefield 6",
  platforms: "",
  genres: "",
  features: "",
  description: "",
  coverUrl: "",
  storeUrl: "",
  ...over,
});

describe("manualGameSchema", () => {
  it("trims and splits lists", () => {
    const r = manualGameSchema.parse(
      form({ name: "  Battlefield 6 ", platforms: "EA App，PC、 PC", genres: "射击, 战术" }),
    );
    expect(r).toMatchObject({
      name: "Battlefield 6",
      platforms: ["EA App", "PC"],
      genres: ["射击", "战术"],
      coverUrl: null,
      storeUrl: null,
    });
  });

  it("requires a name", () => {
    expect(manualGameSchema.safeParse(form({ name: "  " })).success).toBe(false);
  });

  it("accepts only https covers and http(s) store links", () => {
    expect(manualGameSchema.safeParse(form({ coverUrl: "http://x/a.jpg" })).success).toBe(false);
    expect(manualGameSchema.safeParse(form({ coverUrl: "javascript:alert(1)" })).success).toBe(
      false,
    );
    expect(manualGameSchema.safeParse(form({ storeUrl: "javascript:alert(1)" })).success).toBe(
      false,
    );
    expect(
      manualGameSchema.parse(form({ coverUrl: "https://x/a.jpg", storeUrl: "http://ea.com/bf" })),
    ).toMatchObject({ coverUrl: "https://x/a.jpg", storeUrl: "http://ea.com/bf" });
  });
});

describe("helpers", () => {
  it("splitList caps item count and length", () => {
    expect(splitList(Array.from({ length: 20 }, (_, i) => `t${i}`).join(","))).toHaveLength(10);
    expect(splitList("x".repeat(50))[0]).toHaveLength(30);
  });

  it("normalizeGameName ignores case, width and spacing", () => {
    expect(normalizeGameName("  ＡＰＥＸ   Legends ")).toBe(normalizeGameName("apex legends"));
  });

  it("formatPrice", () => {
    expect(formatPrice(4799, "USD")).toContain("47.99");
    expect(formatPrice(100, "XXX-bad")).toBe("1.00 XXX-bad");
  });

  it("only the adder or the owner manages an entry", () => {
    expect(canManageGroupGame("a", { addedById: "a" }, "o")).toBe(true);
    expect(canManageGroupGame("o", { addedById: "a" }, "o")).toBe(true);
    expect(canManageGroupGame("b", { addedById: "a" }, "o")).toBe(false);
    expect(canManageGroupGame("b", { addedById: null }, "o")).toBe(false);
  });
});

describe("sortLibrary", () => {
  const games = [
    { name: "B", addedAt: "2026-01-02", reviewPercent: null, metacritic: 90 },
    { name: "A", addedAt: "2026-01-01", reviewPercent: 95, metacritic: null },
    { name: "C", addedAt: "2026-01-03", reviewPercent: null, metacritic: null },
  ];
  const names = (xs: { name: string }[]) => xs.map((g) => g.name);

  it("by recent, rating (Steam % then Metacritic, unrated last) and name", () => {
    expect(names(sortLibrary(games, "recent"))).toEqual(["C", "B", "A"]);
    expect(names(sortLibrary(games, "rating"))).toEqual(["A", "B", "C"]);
    expect(names(sortLibrary(games, "name"))).toEqual(["A", "B", "C"]);
  });
});
