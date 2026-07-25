#!/usr/bin/env python3
"""
Offline preview of the MyHaut theme.

Renders the landing-page sections with a real Liquid engine and stubbed
Shopify objects, so you can tweak CSS and markup without a store. Useful for
layout work; it is NOT Shopify — no cart, no checkout, no real product data.
For the real thing use `shopify theme dev` (see INSTALL.md).

    pip install python-liquid
    python3 tools/preview.py
    open tools/_preview/index.html

Optional: HERO_IMAGE=1 simulates an uploaded 1672 x 941 hero image so you can
check the "follow the image proportions" height mode.
"""
import json
import os
import re
import shutil
from pathlib import Path

from liquid import Environment, FileSystemLoader

ROOT = Path(__file__).resolve().parent.parent
THEME = ROOT / 'shopify-theme'
OUT = Path(__file__).resolve().parent / '_preview'
OUT.mkdir(parents=True, exist_ok=True)

LOCALE = json.loads((THEME / 'locales/de.default.json').read_text(encoding='utf-8'))


# --------------------------------------------------------------- stub filters

def lookup(path):
    node = LOCALE
    for part in path.split('.'):
        if not isinstance(node, dict) or part not in node:
            return f'translation missing: {path}'
        node = node[part]
    return node


def t_filter(key, **kwargs):
    value = lookup(str(key))
    if isinstance(value, dict):
        value = value.get('other', '')
    for name, replacement in kwargs.items():
        value = value.replace('{{ %s }}' % name, str(replacement))
        value = value.replace('{{%s}}' % name, str(replacement))
    return value


def money(cents):
    try:
        cents = int(cents)
    except (TypeError, ValueError):
        return ''
    return f'{cents // 100},{cents % 100:02d} €'


def image_url(image, **kwargs):
    if isinstance(image, dict):
        return image.get('src', '')
    return image if isinstance(image, str) else ''


def image_tag(src, **kwargs):
    return (
        f'<img src="{src}" alt="{kwargs.get("alt", "")}" '
        f'style="{kwargs.get("style", "")}" loading="lazy">'
    )


def passthrough(value, *args, **kwargs):
    return value


# ------------------------------------------------------------- stub shop data

def variant(variant_id, title, price, compare_at):
    return {
        'id': variant_id, 'title': title, 'price': price,
        'compare_at_price': compare_at, 'available': True,
        'url': '/products/myhaut',
    }


VARIANTS = [
    variant(101, '1× 100 ml', 1890, 2190),
    variant(102, '2× 100 ml', 3990, 4380),
    variant(103, '3× 100 ml', 4990, 6570),
    variant(104, '5× 100 ml', 7990, 10950),
]

PRODUCT = {
    'id': 1,
    'title': 'MyHaut Hair Removal Spray',
    'url': '/products/myhaut',
    'variants': VARIANTS,
    'selected_variant': None,
    'selected_or_first_available_variant': VARIANTS[0],
    'first_available_variant': VARIANTS[0],
    'featured_image': 'assets/mh-demo-product.png',
    'description': '<p>Demo</p>',
}

MENU = {
    'main-menu': {'links': [
        {'title': "So funktioniert's", 'url': '#mh-steps'},
        {'title': 'Ergebnisse', 'url': '#mh-results'},
        {'title': 'Inhaltsstoffe', 'url': '#mh-ingredients'},
        {'title': 'FAQ', 'url': '#mh-faq'},
    ]},
    'footer': {'links': [
        {'title': 'Impressum', 'url': '#'},
        {'title': 'Datenschutz', 'url': '#'},
        {'title': 'AGB', 'url': '#'},
    ]},
}

CONTEXT = {
    'settings': json.loads((THEME / 'config/settings_data.json').read_text())['current'],
    'product': PRODUCT,
    'collections': {'all': {'products': [PRODUCT]}},
    'cart': {'item_count': 0, 'items': [], 'total_price': 0},
    'shop': {'name': 'MyHaut', 'enabled_payment_types': []},
    'routes': {
        'root_url': '/', 'cart_url': '/cart', 'cart_add_url': '/cart/add',
        'all_products_collection_url': '/collections/all',
    },
    'linklists': MENU,
    'localization': {'available_languages': []},
    'request': {'locale': {'iso_code': 'de'}},
}


# ------------------------------------------------------------------- renderer

def schema_of(section_type):
    src = (THEME / 'sections' / f'{section_type}.liquid').read_text(encoding='utf-8')
    match = re.search(r'\{%\s*schema\s*%\}(.*?)\{%\s*endschema\s*%\}', src, re.S)
    return json.loads(match.group(1))


def defaults_for(settings_schema):
    return {s['id']: s.get('default', '') for s in settings_schema if 'id' in s}


def shopify_to_standard(src):
    """Swap the Shopify-only tags for standard Liquid equivalents."""
    src = re.sub(r'\{%-?\s*schema\s*-?%\}.*?\{%-?\s*endschema\s*-?%\}', '', src, flags=re.S)
    src = re.sub(r'\{%-?\s*form\b[^%]*?-?%\}', '<form>', src)
    src = re.sub(r'\{%-?\s*endform\s*-?%\}', '</form>', src)
    src = re.sub(r'\{%-?\s*paginate\b[^%]*?-?%\}', '{% if true %}', src)
    src = re.sub(r'\{%-?\s*endpaginate\s*-?%\}', '{% endif %}', src)
    return src


env = Environment(loader=FileSystemLoader(str(THEME / 'snippets'), ext='.liquid'))
env.filters.update({
    't': t_filter,
    'money': money,
    'image_url': image_url,
    'image_tag': image_tag,
    'asset_url': lambda name: f'assets/{name}',
    'stylesheet_tag': lambda href: f'<link rel="stylesheet" href="{href}">',
    'font_face': passthrough,
    'payment_type_svg_tag': passthrough,
    'video_tag': lambda v, **k: '',
    'default_errors': passthrough,
    'format_address': passthrough,
    'format_code': passthrough,
    'json': lambda v, *a: json.dumps(v, default=str),
    'handle': lambda v: str(v).lower().replace(' ', '-'),
})


def render_section(section_type, conf):
    schema = schema_of(section_type)
    settings = defaults_for(schema.get('settings', []))
    settings.update(conf.get('settings', {}))

    if section_type == 'mh-hero' and os.environ.get('HERO_IMAGE'):
        settings['image'] = {'src': 'assets/mh-demo-hero.webp', 'aspect_ratio': 1.7768}

    blocks = []
    for block_id in conf.get('block_order', []):
        block = conf['blocks'][block_id]
        block_schema = next(
            (b for b in schema.get('blocks', []) if b['type'] == block['type']),
            {'settings': []},
        )
        block_settings = defaults_for(block_schema.get('settings', []))
        block_settings.update(block.get('settings', {}))
        blocks.append({
            'type': block['type'], 'id': block_id,
            'settings': block_settings, 'shopify_attributes': '',
        })

    src = shopify_to_standard((THEME / 'sections' / f'{section_type}.liquid').read_text(encoding='utf-8'))
    return env.from_string(src).render(
        section={'id': conf.get('id', section_type), 'settings': settings, 'blocks': blocks},
        **CONTEXT,
    )


def main():
    template = json.loads((THEME / 'templates/index.json').read_text(encoding='utf-8'))

    body = [
        render_section('announcement-bar', {}),
        render_section('header', {}),
    ]
    for key in template['order']:
        conf = dict(template['sections'][key])
        conf['id'] = key
        body.append(render_section(conf['type'], conf))
    body.append(render_section('footer', {
        'block_order': ['c1', 'c2', 'c3'],
        'blocks': {f'c{i}': {'type': 'column', 'settings': {'menu': 'footer'}} for i in (1, 2, 3)},
    }))

    fonts = (
        'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:'
        'ital,wght@0,300;0,400;0,500;0,600;1,300;1,400'
        '&family=Jost:wght@300;400;500;600&display=swap'
    )
    page = (
        '<!doctype html>\n<html lang="de"><head><meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '<title>MyHaut — local preview</title>\n'
        f'<link rel="stylesheet" href="{fonts}">\n'
        '<link rel="stylesheet" href="assets/myhaut.css">\n'
        '</head><body>\n' + '\n'.join(body) + '\n</body></html>\n'
    )

    (OUT / 'index.html').write_text(page, encoding='utf-8')
    shutil.copytree(THEME / 'assets', OUT / 'assets', dirs_exist_ok=True)
    print(f'Preview written to {OUT / "index.html"}')


if __name__ == '__main__':
    main()
