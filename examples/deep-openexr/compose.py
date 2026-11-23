"""Read Ink's EXR, independently merge a service key, and flatten comparison PNGs."""
import argparse
import json
from pathlib import Path

import numpy as np
import OpenEXR
from PIL import Image, ImageDraw

COLORS = ("R", "G", "B")
CHANNELS = (*COLORS, "A", "Z", "ZBack", "ink.objectId")


def linear(rgb):
    return np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4)


def srgb(rgb):
    return np.where(rgb <= .0031308, 12.92 * rgb, 1.055 * rgb ** (1. / 2.4) - .055)


def service_key(width, height, x, y):
    art = Image.new("RGBA", (51, 63))
    draw = ImageDraw.Draw(art)
    shell = [(19, 0), (32, 0), (46, 12), (48, 26), (37, 39),
             (33, 40), (33, 54), (28, 54), (28, 60), (22, 60),
             (22, 54), (17, 54), (17, 40), (12, 39), (2, 27), (4, 12)]
    draw.polygon(shell, fill="#482747")
    draw.polygon([(19, 3), (31, 3), (44, 14), (45, 24), (34, 37),
                  (16, 37), (5, 25), (7, 14)], fill="#f49aaf")
    draw.polygon([(19, 6), (31, 6), (39, 13), (41, 22), (33, 32),
                  (17, 32), (10, 24), (11, 14)], fill="#aa496f")
    draw.polygon([(22, 10), (28, 10), (35, 17), (35, 23), (28, 30),
                  (22, 30), (15, 23), (15, 17)], fill="#f7c0ba")
    draw.polygon([(25, 12), (33, 20), (25, 28), (17, 20)], fill="#f7dcad")
    draw.rectangle((24, 15, 26, 25), fill="#fff2cf")
    draw.rectangle((20, 19, 30, 21), fill="#fff2cf")
    draw.line([(7, 15), (19, 4), (30, 4)], fill="#ffead2", width=2)
    draw.rectangle((18, 40, 32, 48), fill="#f2a874")
    draw.rectangle((20, 44, 30, 53), fill="#ae5f68")
    draw.rectangle((23, 48, 27, 57), fill="#ffd496")
    for pin in (11, 38):
        draw.rectangle((pin, 29, pin + 2, 36), fill="#fbc3aa")
    target = Image.new("RGBA", (width, height))
    target.alpha_composite(art, (x - 25, y - 20))
    return target


def empty_channels(shape):
    return {name: np.full(shape, None, dtype=object) for name in CHANNELS}


def empty_row(name):
    return np.empty(0, dtype=np.uint32 if name == "ink.objectId" else np.float32)


def insert(shape, key, depth, identifier):
    result = empty_channels(shape)
    rgba = np.asarray(key, dtype=np.float32) / 255
    rgb = linear(rgba[:, :, :3]) * rgba[:, :, 3, None]
    for y, x in zip(*np.nonzero(rgba[:, :, 3])):
        for i, name in enumerate(COLORS):
            result[name][y, x] = np.array([rgb[y, x, i]], dtype=np.float32)
        for name, value in (("A", rgba[y, x, 3]), ("Z", depth), ("ZBack", depth), ("ink.objectId", identifier)):
            result[name][y, x] = np.array([value], dtype=empty_row(name).dtype)
    return result


def merge(source, extra):
    result = {name: source[name].copy() for name in CHANNELS}
    for y, x in np.ndindex(source["Z"].shape):
        if extra["Z"][y, x] is None:
            continue
        a = source["Z"][y, x]
        if a is None:
            for name in CHANNELS:
                result[name][y, x] = extra[name][y, x]
            continue
        order = np.argsort(np.concatenate((a, extra["Z"][y, x])), kind="stable")
        for name in CHANNELS:
            result[name][y, x] = np.concatenate((source[name][y, x], extra[name][y, x]))[order]
    return result


def flatten(samples, filename):
    height, width = samples["Z"].shape
    image = np.zeros((height, width, 4), dtype=np.uint8)
    for y, x in np.ndindex((height, width)):
        alpha = samples["A"][y, x]
        if alpha is None:
            continue
        before = np.concatenate(([1.], np.cumprod(1. - alpha)))
        a = 1. - before[-1]
        if a <= 0:
            continue
        rgb = np.array([np.dot(before[:-1], samples[c][y, x]) for c in COLORS]) / a
        image[y, x, :3] = np.rint(srgb(np.clip(rgb, 0., 1.)) * 255).astype(np.uint8)
        image[y, x, 3] = round(a * 255)
    Image.fromarray(image).save(filename)


def write_deep(filename, source_header, table, names, label):
    camera_attrs = ("chromaticities", "worldToCamera", "worldToNDC", "inkCameraSetback", "inkColorEncoding", "inkDepthSpace")
    header = {name: source_header[name] for name in camera_attrs if name in source_header}
    header.update(type=OpenEXR.deepscanline, compression=OpenEXR.ZIPS_COMPRESSION,
                  name=label, inkIds=json.dumps(names))
    OpenEXR.File(header, dict(table)).write(str(filename))


def demonstrate(source_path, out):
    out.mkdir(parents=True, exist_ok=True)
    with OpenEXR.File(str(source_path), separate_channels=True) as file:
        header = dict(file.header())
        if header["type"] != OpenEXR.deepscanline:
            raise ValueError("Expected a deep scanline OpenEXR")
        names = json.loads(header["inkIds"])
        source = {name: file.channels()[name].pixels for name in CHANNELS}
    height, width = source["Z"].shape
    x, y = round(width * .53), round(height * .50)
    values = source["Z"][y, x]
    ids = [names["objects"][i] for i in source["ink.objectId"][y, x]]
    front, back = ids.index("teal front sheet"), ids.index("amber rear sheet")
    if not (values[front] < values[back] and 0 < source["A"][y, x][front] < 1
            and 0 < source["A"][y, x][back] < 1):
        raise ValueError("The selected ray must cross two transparent sheets in depth order")
    key = service_key(width, height, x, y)
    key.save(out / "service-key.png")
    registration = len(names["objects"])
    names["objects"].append("service key")
    if not 0 < key.getpixel((x, y))[3] <= 255:
        raise ValueError("The key must cross the selected ray")
    depths = {"front": float(values[front] - .5), "between": float((values[front] + values[back]) / 2),
              "behind": float((values[back] + values[-1]) / 2)}
    flatten(source, out / "source.png")
    report = {"reader": "OpenEXR " + OpenEXR.__version__, "width": width, "height": height,
              "pixel": [x, y], "cases": {}, "sourceCounts": json.loads(header["inkStats"])}
    for case, depth in depths.items():
        extra = insert((height, width), key, depth, registration)
        combined = merge(source, extra)
        flatten(combined, out / (case + ".png"))
        if case == "between":
            write_deep(out / "service-key.exr", header, extra, names, "service key")
            write_deep(out / "merged-between.exr", header, combined, names, "relay with service key")
            with OpenEXR.File(str(out / "merged-between.exr"), separate_channels=True) as check:
                np.testing.assert_array_equal(check.channels()["Z"].pixels[y, x], combined["Z"][y, x])
                np.testing.assert_array_equal(check.channels()["ink.objectId"].pixels[y, x], combined["ink.objectId"][y, x])
        report["cases"][case] = {"depth": depth, "samples": [
            {"object": names["objects"][identifier], "z": float(z), "alpha": float(a)}
            for identifier, z, a in zip(combined["ink.objectId"][y, x], combined["Z"][y, x], combined["A"][y, x])
        ]}
    if [row["object"] for row in report["cases"]["between"]["samples"]][:3] != [
            "teal front sheet", "service key", "amber rear sheet"]:
        raise ValueError("The external composite did not place the key between the sheets")
    (out / "insertion-report.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


if __name__ == "__main__":
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("plate", type=Path)
    args.add_argument("out", type=Path)
    paths = args.parse_args()
    evidence = demonstrate(paths.plate, paths.out)
    print(evidence["reader"], evidence["pixel"], evidence["cases"]["between"]["samples"])
