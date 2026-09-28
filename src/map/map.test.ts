import { describe, expect, test } from "bun:test";
import { geometryFromMapUrl } from "../uber/trips.js";
import { BrailleCanvas } from "./canvas.js";
import { boundsOf, decodePolyline, distanceKm, project } from "./geo.js";
import { graphicsProtocol, inlineImage } from "./image.js";

describe("geo", () => {
  test("decodes Google polylines", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
      { latitude: 38.5, longitude: -120.2 },
      { latitude: 40.7, longitude: -120.95 },
      { latitude: 43.252, longitude: -126.453 },
    ]);
  });

  test("projects Web Mercator and keeps north up", () => {
    const origin = project({ latitude: 0, longitude: 0 }, 0);
    expect(origin).toEqual({ x: 128, y: 128 });
    expect(project({ latitude: 4.68, longitude: -74.05 }, 14).y).toBeLessThan(project({ latitude: 4.6, longitude: -74.05 }, 14).y);
  });

  test("pads bounds and never collapses to a point", () => {
    const bounds = boundsOf([{ latitude: 4.7, longitude: -74 }]);
    expect(bounds.north - bounds.south).toBeGreaterThan(0.004);
    expect(distanceKm({ latitude: 4.6766, longitude: -74.0482 }, { latitude: 4.6668, longitude: -74.0527 })).toBeCloseTo(1.2, 1);
  });
});

describe("braille canvas", () => {
  test("maps dots to braille bits", () => {
    const canvas = new BrailleCanvas(1, 1);
    canvas.dot(0, 0, { color: [255, 255, 255], layer: 1 });
    canvas.dot(1, 3, { color: [255, 255, 255], layer: 1 });
    expect(canvas.render(false)).toEqual([String.fromCharCode(0x2800 | 0x01 | 0x80)]);
  });

  test("draws continuous lines and lets glyphs win", () => {
    const canvas = new BrailleCanvas(4, 1);
    canvas.line({ x: 0, y: 0 }, { x: 7, y: 0 }, { color: [1, 1, 1], layer: 1 });
    canvas.glyph({ x: 2, y: 0 }, "●", { color: [0, 255, 0], layer: 9 });
    expect(canvas.render(false)[0]).toBe("⠉●⠉⠉");
  });

  test("labels only land in free space", () => {
    const canvas = new BrailleCanvas(10, 3);
    canvas.text({ x: 0, y: 4 }, "Calle", { color: [1, 1, 1], layer: 5 });
    expect(canvas.isFree({ x: 0, y: 4 }, 3)).toBe(false);
    expect(canvas.isFree({ x: 14, y: 4 }, 3)).toBe(false);
  });
});

describe("trip geometry", () => {
  test("reads the route and markers out of Uber's static map url", () => {
    const url =
      "https://maps.googleapis.com/maps/api/staticmap?size=580x267&markers=%7Canchor%3Acenter%7C4.67660%2C-74.04820&markers=%7Canchor%3Acenter%7C4.66680%2C-74.05270&path=color%3A0x2DBAE4FF%7Cweight%3A4%7Cenc%3A_p~iF~ps%7CU_ulLnnqC";
    expect(geometryFromMapUrl(url)).toEqual({
      polyline: "_p~iF~ps|U_ulLnnqC",
      pickup: { latitude: 4.6766, longitude: -74.0482 },
      dropoff: { latitude: 4.6668, longitude: -74.0527 },
    });
    expect(geometryFromMapUrl(null)).toBeNull();
  });
});

describe("inline images", () => {
  test("iTerm2 and Kitty sequences carry the PNG", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect(inlineImage(png, { cols: 40, protocol: "iterm" })).toStartWith("\u001b]1337;File=inline=1;size=4;width=40");
    expect(inlineImage(png, { cols: 40, protocol: "kitty" })).toStartWith("\u001b_Ga=T,f=100,c=40,m=0;iVBORw==");
  });

  test("never draws images inside tmux or when piped", () => {
    expect(graphicsProtocol({ TERM_PROGRAM: "WarpTerminal", TMUX: "/tmp/tmux" })).toBeNull();
  });
});
