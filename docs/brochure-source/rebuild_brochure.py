#!/usr/bin/env python3
"""Take The Hazelnut Movement out of the Luke 14 Ministries tri-fold brochure.

WHY THIS FILE EXISTS
--------------------
public/resources/luke-14-ministries-brochure.pdf is a Canva design (author
Tessa Coates, August 2025): two landscape letter pages, three panels each,
printed both sides and folded. On 28 Oct 2026 The Hazelnut Movement was spun
out to another ministry and stopped being part of Luke 14 (Lawrence), so the
brochure had to lose it in two places:

  * the cover panel (page 1, right) listed four programs -- CAMP CELEBRATE,
    LUKE 14 PARTY, WHEELS FOR KENYA, THE HAZELNUT MOVEMENT;
  * the inside right panel (page 2) was Hazelnut's own: a photo of a family
    reading "The Hazelnut" book over a pink box of text, above the yellow
    mission-statement box.

Julia Erman's name is not in the brochure.

WHY AN EDIT AND NOT A REBUILD
-----------------------------
The first plan was to rebuild both pages as HTML from the PDF's own text and
images and print that with headless Chrome, the way md files/render.py prints
the SharePoint documents. It would have been worse: the design uses Public
Sans and Canva Sans, and neither is installed here -- the PDF carries only
subsets of them, each holding just the letters the brochure already uses (no
capital S in the heading weight, for one). Any rebuild would have reset every
panel in a stand-in font. So this script edits the PDF itself, with pypdf (the
one PDF tool already on the build machine): it deletes the Hazelnut drawing
instructions and draws a photo in their place. Everything else -- the text,
fonts, colours, the other photographs at full print resolution, the QR code --
is the original, byte for byte.

WHAT IT CHANGES
---------------
Page 1 (outside): the line THE HAZELNUT MOVEMENT is deleted from the cover's
list, and the other three lines move down one line so the list still ends at
the same bottom margin.

Page 2 (inside): the Hazelnut photo, the pink box, its heading and its text
are deleted; the panel's upper part (from the top of the sheet down to the
yellow box) becomes one photograph, public/images/DSC04574.jpg -- three women
in green camp shirts on a woodland path, already published on the site's
Resources page -- scaled to fill the panel and cropped evenly at the sides.
The yellow box ("Creating opportunities for life changing encounters...",
the donate line) is untouched. No new words are added anywhere: a new panel
of text would be new copy nobody had approved, and could not be set in the
brochure's own font anyway (see above).

The fonts and images left unused by the edit are dropped from the file.

USAGE
-----
The script reads the ORIGINAL Canva file, which is no longer in
public/resources (this script's output replaced it). Get it from git, from
the commit before the change:

    git show 3d00ef3:public/resources/luke-14-ministries-brochure.pdf > original.pdf
    python docs/brochure-source/rebuild_brochure.py original.pdf public/resources/luke-14-ministries-brochure.pdf

Run from the repository root (the photo is read from public/images/). Needs
only pypdf. It checks its own work: it stops if any Hazelnut text survives,
or if anything it expected to find was not there -- so a re-exported Canva
file with a different layout fails loudly instead of being half edited.

If the brochure is ever redesigned in Canva, do it there instead and drop the
new export into public/resources/ under the same name; this script is then
history.
"""

import datetime
import re
import struct
import sys
from pathlib import Path

import pypdf
from pypdf.generic import (
    ContentStream,
    EncodedStreamObject,
    FloatObject,
    NameObject,
    NumberObject,
    TextStringObject,
)

REPLACEMENT_PHOTO = Path('public/images/DSC04574.jpg')
NEW_IMAGE_NAME = '/XL14Photo'
# Words that must survive the edit, checked in the output.
KEEP = ('Creating opportunities', 'Support us with a contribution', 'luke14ministries.net/donate',
        'WHEELS FOR KENYA', 'Camp', 'International', 'GET')


# --- reading text back out of the content stream ---------------------------

def to_unicode(font):
    """Glyph id -> character, from the font's ToUnicode CMap (Canva fonts are
    Identity-H, two bytes per glyph)."""
    tu = font.get('/ToUnicode')
    if tu is None:
        return {}
    data = tu.get_object().get_data().decode('latin1')
    out = {}
    for block in re.findall(r'beginbfchar(.*?)endbfchar', data, re.S):
        for a, b in re.findall(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', block):
            out[int(a, 16)] = bytes.fromhex(b).decode('utf-16-be')
    for block in re.findall(r'beginbfrange(.*?)endbfrange', data, re.S):
        for a, b, c in re.findall(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', block):
            lo, hi, start = int(a, 16), int(b, 16), int(c, 16)
            for g in range(lo, hi + 1):
                out[g] = chr(start + g - lo)
    return out


def decode(maps, font, operand):
    raw = operand.original_bytes if hasattr(operand, 'original_bytes') else bytes(operand)
    m = maps.get(font, {})
    return ''.join(m.get(raw[i] * 256 + raw[i + 1], '?') for i in range(0, len(raw) - 1, 2))


def text_blocks(ops, maps):
    """Each BT..ET block as (start index, end index, text)."""
    blocks, font, start, buf = [], None, None, ''
    for i, (operands, op) in enumerate(ops):
        if op == b'Tf':
            font = operands[0]
        elif op == b'BT':
            start, buf = i, ''
        elif op == b'Tj':
            buf += decode(maps, font, operands[0])
        elif op == b'TJ':
            buf += ''.join(decode(maps, font, x) for x in operands[0] if not isinstance(x, (int, float, FloatObject, NumberObject)))
        elif op == b'ET':
            blocks.append((start, i, buf))
    return blocks


def top_groups(ops):
    """The page's top-level q..Q groups, as (start, end) index pairs. Canva
    wraps the whole page in one outer q..Q; each element sits one level in."""
    groups, depth, start = [], 0, None
    for i, (_, op) in enumerate(ops):
        if op == b'q':
            depth += 1
            if depth == 2:
                start = i
        elif op == b'Q':
            if depth == 2:
                groups.append((start, i))
            depth -= 1
    return groups


def innermost_group(ops, index):
    """The smallest q..Q group around one operation. Canva sometimes puts
    several text boxes in one clipping group (the Hazelnut heading, its text
    and the mission statement share one), so text is removed box by box."""
    stack, best = [], None
    for i, (_, op) in enumerate(ops):
        if op == b'q':
            stack.append(i)
        elif op == b'Q':
            s = stack.pop()
            if s <= index <= i and (best is None or i - s < best[1] - best[0]):
                best = (s, i)
    return best


def marked_content_balance(ops):
    """Opens minus closes. Canva's marked-content tags straddle its q..Q
    groups (a group often begins by closing the previous group's tag), so a
    deletion has to put back whatever imbalance it removed."""
    return sum(1 for _, op in ops if op in (b'BDC', b'BMC')) - sum(1 for _, op in ops if op == b'EMC')


def rebalance(removed):
    n = marked_content_balance(removed)
    if n > 0:  # removed n opens whose closes are still further on
        return [([NameObject('/Span')], b'BMC')] * n
    return [([], b'EMC')] * (-n)  # removed closes of tags opened earlier


def font_maps(page):
    return {k: to_unicode(f.get_object()) for k, f in page['/Resources']['/Font'].items()}


def require(cond, what):
    if not cond:
        sys.exit('STOP: ' + what + ' -- the input is not the brochure this script was written for.')


# --- page 1: the cover's program list ---------------------------------------

def edit_cover(page, reader):
    cs = ContentStream(page.get_contents(), reader)
    ops = cs.operations
    blocks = text_blocks(ops, font_maps(page))
    names = ['CAMP CELEBRATE', 'LUKE 14 PARTY', 'WHEELS FOR KENYA', 'THE HAZELNUT MOVEMENT']
    found = {b[2].strip(): b for b in blocks if b[2].strip() in names}
    require(set(found) == set(names), 'the cover list of four programs was not found')

    def tm_index(block):
        return next(i for i in range(block[0], block[1]) if ops[i][1] == b'Tm')

    ys = [float(ops[tm_index(found[n])][0][5]) for n in names]
    step = ys[1] - ys[0]
    require(all(abs((ys[k + 1] - ys[k]) - step) < 0.01 for k in range(3)), 'the list lines are not evenly spaced')

    # Delete the Hazelnut line: from the colour it sets (the two ops before the
    # tag that opens it) through the EMC that closes its NonStruct tag.
    hz = found['THE HAZELNUT MOVEMENT']
    start = hz[0]
    while ops[start - 1][1] in (b'BDC', b'EMC', b'rg', b'RG'):
        start -= 1
    end = hz[1] + 1
    require(ops[end][1] == b'EMC', 'the Hazelnut line is not closed where expected')

    # Move the three remaining lines down one step (the text matrix is in the
    # group's own, y-down, coordinates).
    for n in names[:3]:
        operands = ops[tm_index(found[n])][0]
        operands[5] = FloatObject(float(operands[5]) + step)

    removed = ops[start:end + 1]
    ops[start:end + 1] = rebalance(removed)
    page.replace_contents(cs)


# --- page 2: the Hazelnut panel ----------------------------------------------

def jpeg_size(data):
    i = 2
    while i < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xC0, 0xC1, 0xC2):
            h, w = struct.unpack('>HH', data[i + 5:i + 9])
            return w, h, data[i + 9]
        if marker == 0x01 or 0xD0 <= marker <= 0xD8:
            i += 2
            continue
        i += 2 + struct.unpack('>H', data[i + 2:i + 4])[0]
    sys.exit('STOP: could not read the size of ' + str(REPLACEMENT_PHOTO))


def edit_inside(page, reader, writer):
    cs = ContentStream(page.get_contents(), reader)
    ops = cs.operations
    maps = font_maps(page)
    groups = top_groups(ops)

    def groups_drawing(xobject):
        return [g for g in groups if any(op == b'Do' and operands[0] == xobject for operands, op in ops[g[0]:g[1] + 1])]

    pink = groups_drawing('/X5')     # the pink box (a form holding one filled rectangle)
    photo = groups_drawing('/X6')    # the family reading "The Hazelnut"
    texts = [innermost_group(ops, b[0]) for b in text_blocks(ops, maps) if 'Hazelnut' in b[2]]
    # Those boxes must not also hold the yellow box's words (the heading's
    # second line, "Movement", does share the heading's box, which is right).
    for s, e in texts:
        inside = ' '.join(b[2] for b in text_blocks(ops[s:e + 1], maps))
        require(not any(k in inside for k in KEEP), 'a Hazelnut text box also holds text that stays')
    require(len(pink) == 1 and len(photo) == 1 and len(texts) >= 2, 'the Hazelnut panel was not found')
    xobjs = page['/Resources']['/XObject']
    require(xobjs['/X6'].get_object()['/Width'] == 1170, 'the Hazelnut photo is not the expected image')
    pink_form = xobjs['/X5'].get_object()
    require(b'.9686 .8235 .8157' in pink_form.get_data(), 'X5 is not the pink box')

    # The panel's photo area: from the panel's left edge (where the Hazelnut
    # photo began) to the page's right edge, and from the top of the sheet to
    # the bottom of the pink box, which overlapped the yellow box's top.
    # Page units here are 1/300 inch, y downward (Canva's 0.24 scale).
    photo_cm = next(operands for operands, op in ops[photo[0][0]:photo[0][1]] if op == b'cm')
    left = float(photo_cm[4])
    clip = next(operands for operands, op in ops[pink[0][0]:pink[0][1]] if op == b're')
    bottom = float(clip[1]) + float(clip[3])
    right, top = 3300.0, 0.0
    width, height = right - left, bottom - top

    jpeg = REPLACEMENT_PHOTO.read_bytes()
    iw, ih, comps = jpeg_size(jpeg)
    require(comps == 3, 'the replacement photo is not an RGB JPEG')
    # Fill the panel ("cover"), centred, cropping whichever way overflows.
    scale = max(width / iw, height / ih)
    dw, dh = iw * scale, ih * scale
    dx, dy = left - (dw - width) / 2, top - (dh - height) / 2

    image = EncodedStreamObject()
    image._data = jpeg  # already JPEG-compressed: stored as is (DCTDecode)
    image.update({
        NameObject('/Type'): NameObject('/XObject'),
        NameObject('/Subtype'): NameObject('/Image'),
        NameObject('/Width'): NumberObject(iw),
        NameObject('/Height'): NumberObject(ih),
        NameObject('/ColorSpace'): NameObject('/DeviceRGB'),
        NameObject('/BitsPerComponent'): NumberObject(8),
        NameObject('/Filter'): NameObject('/DCTDecode'),
    })
    xobjs[NameObject(NEW_IMAGE_NAME)] = writer._add_object(image)

    def f(x):
        return FloatObject(round(x, 4))

    new_group = [
        ([], b'q'),
        ([f(left), f(top), f(width), f(height)], b're'),
        ([], b'W*'),
        ([], b'n'),
        ([], b'q'),
        # Image space is a unit square with y up; the page's y runs down, so
        # the image is flipped by a negative height and anchored at its bottom.
        ([f(dw), f(0), f(0), f(-dh), f(dx), f(dy + dh)], b'cm'),
        ([NameObject('/Artifact')], b'BMC'),
        ([NameObject(NEW_IMAGE_NAME)], b'Do'),
        ([], b'EMC'),
        ([], b'Q'),
        ([], b'Q'),
    ]

    # Delete back to front so earlier indexes stay valid; the photo goes where
    # the pink box was drawn, so it layers exactly as the box did (over the
    # yellow box's top edge, under the blue middle panel's edge).
    doomed = sorted(set(pink + photo + texts), reverse=True)
    for s, e in doomed:
        removed = ops[s:e + 1]
        replacement = rebalance(removed)
        if (s, e) == pink[0]:
            replacement = new_group + replacement
        ops[s:e + 1] = replacement
    page.replace_contents(cs)
    del xobjs['/X5'], xobjs['/X6']


# --- tidying and checking -----------------------------------------------------

def drop_unused_fonts(page):
    data = page.get_contents().get_data()
    fonts = page['/Resources']['/Font']
    for name in list(fonts.keys()):
        if not re.search(re.escape(name.encode()) + rb'\s+[\d.]+\s+Tf', data):
            del fonts[name]


def all_text(reader):
    out = []
    for page in reader.pages:
        ops = ContentStream(page.get_contents(), reader).operations
        out.append(' '.join(b[2] for b in text_blocks(ops, font_maps(page))))
    return out


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__.split('USAGE')[1].split('If the brochure')[0])
    src, dst = sys.argv[1], sys.argv[2]
    reader = pypdf.PdfReader(src)
    require(len(reader.pages) == 2 and reader.metadata.get('/Creator') == 'Canva', 'expected the two-page Canva file')
    writer = pypdf.PdfWriter(clone_from=reader)

    edit_cover(writer.pages[0], writer)
    edit_inside(writer.pages[1], writer, writer)
    for page in writer.pages:
        drop_unused_fonts(page)
        page.compress_content_streams()

    writer.add_metadata({
        '/ModDate': datetime.datetime.now(datetime.timezone.utc).strftime("D:%Y%m%d%H%M%S+00'00'"),
        '/Producer': TextStringObject('Canva; The Hazelnut Movement removed 28 Oct 2026 by docs/brochure-source/rebuild_brochure.py (pypdf)'),
    })
    writer.compress_identical_objects(remove_duplicates=False, remove_unreferenced=True)
    with open(dst, 'wb') as fh:
        writer.write(fh)

    check = pypdf.PdfReader(dst)
    words = ' '.join(all_text(check)) + ' '.join(p.extract_text() for p in check.pages)
    # The output is already written by now; a failed check says so loudly
    # rather than letting a bad file be committed.
    if 'hazel' in words.lower() or 'erman' in words.lower():
        sys.exit('STOP: Hazelnut text survived in ' + dst + ' -- do not use it.')
    if not all(k in words for k in KEEP):
        sys.exit('STOP: text that should stay is missing from ' + dst + ' -- do not use it.')
    print(f'{dst}: {len(check.pages)} pages, {Path(dst).stat().st_size:,} bytes (was {Path(src).stat().st_size:,})')


if __name__ == '__main__':
    main()
