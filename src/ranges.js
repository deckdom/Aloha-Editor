/**
 * ranges.js is part of Aloha Editor project http://aloha-editor.org
 *
 * Aloha Editor is a WYSIWYG HTML5 inline editing library and editor.
 * Copyright (c) 2010-2014 Gentics Software GmbH, Vienna, Austria.
 * Contributors http://aloha-editor.org/contribution.php
 *
 * @reference
 * https://dvcs.w3.org/hg/editing/raw-file/tip/editing.html#deleting-the-selection
 */
define([
	'dom',
	'mutation',
	'arrays',
	'stable-range',
	'html',
	'traversing',
	'functions',
	'cursors',
	'boundaries',
	'paths'
], function Ranges(
	Dom,
	Mutation,
	Arrays,
	StableRange,
	Html,
	Traversing,
	Fn,
	Cursors,
	Boundaries,
	Paths
) {
	'use strict';

	/**
	 * Gets the currently selected range from the given document element.
	 *
	 * If no document element is given, the document element of the calling
	 * frame's window will be used.
	 *
	 * @param  {!Document} doc
	 * @return {?Range} Browser's selected range or null if not selection exists
	 */
	function get(doc) {
		var selection = (doc || document).getSelection();
		return selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
	}

	/**
	 * Sets the given range to the browser selection. This will cause the
	 * selection to be visually rendered by the user agent.
	 *
	 * @param  {Range} range
	 * @return {Selection} Browser selection to which the range was set
	 */
	function select(range) {
		var selection = range.startContainer.ownerDocument.getSelection();
		selection.removeAllRanges();
		selection.addRange(range);
		return selection;
	}

	/**
	 * Creates a range object with boundaries defined by containers, and offsets
	 * in those containers.
	 *
	 * @param  {Element} startContainer
	 * @param  {number}  startOffset
	 * @param  {Element} endContainer
	 * @param  {number}  endOffset
	 * @return {Range}
	 */
	function create(startContainer, startOffset, endContainer, endOffset) {
		var range = startContainer.ownerDocument.createRange();
		range.setStart(startContainer, startOffset || 0);
		if (endContainer) {
			range.setEnd(endContainer, endOffset || 0);
		} else {
			range.setEnd(startContainer, startOffset || 0);
		}
		return range;
	}

	/**
	 * Checks whether two ranges are equal.  Ranges are equal if their
	 * corresponding boundary containers and offsets are strictly equal.
	 *
	 * @param  {Range} a
	 * @param  {Range} b
	 * @return {boolean}
	 */
	function equals(a, b) {
		return a.startContainer === b.startContainer
		    && a.startOffset    === b.startOffset
		    && a.endContainer   === b.endContainer
		    && a.endOffset      === b.endOffset;
	}

	/**
	 * Creates a range from the horizontal and vertical offset pixel positions
	 * relative to upper-left corner the document body.
	 *
	 * Returns a collapsed range for the position where the text insertion
	 * indicator would be rendered.
	 *
	 * @reference:
	 * http://dev.w3.org/csswg/cssom-view/#dom-document-caretpositionfrompoint
	 * http://stackoverflow.com/questions/3189812/creating-a-collapsed-range-from-a-pixel-position-in-ff-webkit
	 * http://jsfiddle.net/timdown/ABjQP/8/
	 * http://lists.w3.org/Archives/Public/public-webapps/2009OctDec/0113.html
	 *
	 * @private
	 * @param  {number}    x
	 * @param  {number}    y
	 * @param  {!Document} doc
	 * @return {?Range}
	 */
	function fromPoint(x, y, doc) {
		if (x < 0 || y < 0) {
			return null;
		}
		if (doc.caretRangeFromPoint) {
			return doc.caretRangeFromPoint(x, y);
		}
		if (doc.caretPositionFromPoint) {
			var pos = doc.caretPositionFromPoint(x, y);
			return create(pos.offsetNode, pos.offset);
		}
		if (doc.elementFromPoint) {
			throw 'fromPoint() unimplemented for this browser';
		}
	}

	/**
	 * Gets the given node's nearest non-editable parent.
	 *
	 * @private
	 * @param  {Element} node
	 * @return {?Element}
	 */
	function parentBlock(node) {
		var block = Dom.isEditable(node) ? Dom.editingHost(node) : node;
		var parent = Dom.upWhile(block, function (node) {
			return node.parentNode && !Dom.isEditable(node.parentNode);
		});
		return (Dom.Nodes.DOCUMENT === parent.nodeType) ? null : parent;
	}

	/**
	 * Creates a range from the horizontal and vertical offset pixel positions
	 * relative to upper-left corner of the document body.
	 *
	 * Will ensure that the range is contained in a content editable node.
	 *
	 * @param  {number}    x
	 * @param  {number}    y
	 * @param  {!Document} doc
	 * @return {?Range} Null if no suitable range can be determined
	 */
	function fromPosition(x, y, doc) {
		var range = fromPoint(x, y, doc);
		if (!range) {
			return null;
		}
		if (Dom.isEditableNode(range.commonAncestorContainer)) {
			return range;
		}
		var block = parentBlock(range.commonAncestorContainer);
		if (!block || !block.parentNode) {
			return null;
		}
		var body = block.ownerDocument.body;
		var offsets = Dom.offset(block);
		var offset = Dom.nodeIndex(block);
		var pointX = x + body.scrollLeft;
		var blockX = offsets.left + body.scrollLeft + block.offsetWidth;
		if (pointX > blockX) {
			offset += 1;
		}
		return create(block.parentNode, offset);
	}

	/**
	 * Creates a range based on the given start and end boundaries.
	 *
	 * @param  {Boundary} start
	 * @param  {Boundary} end
	 * @return {Range}
	 */
	function fromBoundaries(start, end) {
		return create(
			Boundaries.container(start),
			Boundaries.offset(start),
			Boundaries.container(end),
			Boundaries.offset(end)
		);
	}

	/**
	 * @private
	 */
	function seekBoundaryPoint(range, container, offset, oppositeContainer,
	                           oppositeOffset, setFn, ignore, backwards) {
		var cursor = Cursors.cursorFromBoundaryPoint(container, offset);

		// Because when seeking backwards, if the boundary point is inside a
		// text node, trimming starts after it. When seeking forwards, the
		// cursor starts before the node, which is what
		// cursorFromBoundaryPoint() does automatically.
		if (backwards
				&& Dom.isTextNode(container)
					&& offset > 0
						&& offset < container.length) {
			if (cursor.next()) {
				if (!ignore(cursor)) {
					return range;
				}
				// Bacause the text node can be ignored, we go back to the
				// initial position.
				cursor.prev();
			}
		}
		var opposite = Cursors.cursorFromBoundaryPoint(
			oppositeContainer,
			oppositeOffset
		);
		var changed = false;
		while (!cursor.equals(opposite)
		           && ignore(cursor)
		           && (backwards ? cursor.prev() : cursor.next())) {
			changed = true;
		}
		if (changed) {
			setFn(range, cursor);
		}
		return range;
	}

	/**
	 * Starting with the given range's start and end boundary points, seek
	 * inward using a cursor, passing the cursor to ignoreLeft and ignoreRight,
	 * stopping when either of these returns true, adjusting the given range to
	 * the end positions of both cursors.
	 *
	 * The dom cursor passed to ignoreLeft and ignoreRight does not traverse
	 * positions inside text nodes. The exact rules for when text node
	 * containers are passed are as follows: If the left boundary point is
	 * inside a text node, trimming will start before it. If the right boundary
	 * point is inside a text node, trimming will start after it.
	 * ignoreLeft/ignoreRight() are invoked with the cursor before/after the
	 * text node that contains the boundary point.
	 *
	 * @todo: Implement in terms of boundaries
	 *
	 * @param  {Range}     range
	 * @param  {function=} ignoreLeft
	 * @param  {function=} ignoreRight
	 * @return {Range}
	 */
	function trim(range, ignoreLeft, ignoreRight) {
		ignoreLeft = ignoreLeft || Fn.returnFalse;
		ignoreRight = ignoreRight || Fn.returnFalse;
		if (range.collapsed) {
			return range;
		}
		// Because range may be mutated, we must store its properties before
		// doing anything else.
		var sc = range.startContainer;
		var so = range.startOffset;
		var ec = range.endContainer;
		var eo = range.endOffset;
		seekBoundaryPoint(
			range,
			sc,
			so,
			ec,
			eo,
			Cursors.setRangeStart,
			ignoreLeft,
			false
		);
		sc = range.startContainer;
		so = range.startOffset;
		seekBoundaryPoint(
			range,
			ec,
			eo,
			sc,
			so,
			Cursors.setRangeEnd,
			ignoreRight,
			true
		);
		return range;
	}

	/**
	 * Expands two boundaries to contain a word.
	 *
	 * The boundaries represent the start and end containers of a range.
	 *
	 * A word is a collection of visible characters terminated by a space or
	 * punctuation character or a word-breaker (in languages that do not use
	 * space to delimit word boundaries).
	 *
	 * foo b[a]r baz ==> foo [bar] baz
	 *
	 * @private
	 * @param  {Boundary} start
	 * @param  {Boundary} end
	 * @return {Array.<Boundary>}
	 */
	function expandToWord(start, end) {
		return [
			Traversing.prev(start, 'word') || start,
			Traversing.next(end,   'word') || end
		];
	}

	/**
	 * Expands two boundaries to contain a block.
	 *
	 * The boundaries represent the start and end containers of a range.
	 *
	 *
	 * [,] = start,end boundary
	 *
	 *  +-------+     [ +-------+
	 *  | block |       | block |
	 *  |       |  ==>  |       |
	 *  | [ ]   |       |       |
	 *  +-------+       +-------+ ]
	 *
	 * @private
	 * @param  {Boundary} start
	 * @param  {Boundary} end
	 * @return {Array.<Boundary>}
	 */
	function expandToBlock(start, end) {
		var cac = Boundaries.commonContainer(start, end);
		var ancestors = Dom.childAndParentsUntilIncl(cac, function (node) {
			return Html.hasLinebreakingStyle(node) || Dom.isEditingHost(node);
		});
		var node = Arrays.last(ancestors);
		var len = Dom.nodeLength(node);
		var prev = Boundaries.create(node, 0);
		var next = Traversing.next(Boundaries.create(node, len));
		return [prev, next];
	}

	/**
	 * Expands the range to contain the given unit.
	 *
	 * The second parameter `unit` specifies the unit with which to expand.
	 * This value may be one of the following strings:
	 *
	 * "word" -- Expand to completely contain a word.
	 *
	 *		A word is the smallest semantic unit.  It is a contigious sequence
	 *		of characters terminated by a space or puncuation character or a
	 *		word-breaker (in languages that do not use space to delimit word
	 *		boundaries).
	 *
	 * "block" -- Expand to completely contain the a block.
	 *
	 * @param  {Range} range
	 * @param  {unit}  unit
	 * @return {Range}
	 */
	function expand(range, unit) {
		var boundaries = Boundaries.fromRange(range);
		var expanded;
		switch (unit) {
		case 'word':
			expanded = expandToWord(boundaries[0], boundaries[1]);
			break;
		case 'block':
			expanded = expandToBlock(boundaries[0], boundaries[1]);
			break;
		default:
			throw '"' + unit + '"? what\'s that?';
		}
		return fromBoundaries(expanded[0], expanded[1]);
	}

	/**
	 * Expands the given range to encapsulate all adjacent unrendered
	 * characters.
	 *
	 * This operation should therefore never cause the visual representation of
	 * the range to change.
	 *
	 * Since it is impossible to place a range immediately behind an invisible
	 * character, this function will only ever need to expand the range's end
	 * position.
	 *
	 * @param  {Range} range
	 * @return {Range}
	 */
	function envelopeInvisibleCharacters(range) {
		var end = Boundaries.fromRangeEnd(range);
		if (Boundaries.isTextBoundary(end)) {
			var offset = Html.nextSignificantOffset(end);
			if (-1 === offset) {
				range.setEnd(range.endContainer, Dom.nodeLength(range.endContainer));
			} else {
				range.setEnd(Boundaries.container(end), offset);
			}
		}
		return range;
	}

	/**
	 * Like trim() but ignores closing (to the left) and opening positions (to
	 * the right).
	 *
	 * @param  {Range}     range
	 * @param  {function=} ignoreLeft
	 * @param  {function=} ignoreRight
	 * @return {Range}
	 */
	function trimClosingOpening(range, ignoreLeft, ignoreRight) {
		ignoreLeft = ignoreLeft || Fn.returnFalse;
		ignoreRight = ignoreRight || Fn.returnFalse;
		trim(range, function (cursor) {
			return cursor.atEnd || ignoreLeft(cursor.node);
		}, function (cursor) {
			return !cursor.prevSibling() || ignoreRight(cursor.prevSibling());
		});
		return range;
	}

	/**
	 * Ensures that the given start point Cursor is not at a "start position"
	 * and the given end point Cursor is not at an "end position" by moving the
	 * points to the left and right respectively.  This is effectively the
	 * opposite of trimBoundaries().
	 *
	 * @param {Cusor} start
	 * @param {Cusor} end
	 * @param {function:boolean} until
	 *        Optional predicate.  May be used to stop the trimming process from
	 *        moving the Cursor from within an element outside of it.
	 * @param {function:boolean} ignore
	 *        Optional predicate.  May be used to ignore (skip)
	 *        following/preceding siblings which otherwise would stop the
	 *        trimming process, like for example underendered whitespace.
	 */
	function expandBoundaries(start, end, until, ignore) {
		until = until || Fn.returnFalse;
		ignore = ignore || Fn.returnFalse;
		start.prevWhile(function (start) {
			var prevSibling = start.prevSibling();
			return prevSibling ? ignore(prevSibling) : !until(start.parent());
		});
		end.nextWhile(function (end) {
			return !end.atEnd ? ignore(end.node) : !until(end.parent());
		});
	}

	/**
	 * Ensures that the given start point Cursor is not at an "start position"
	 * and the given end point Cursor is not at an "end position" by moving the
	 * points to the left and right respectively.  This is effectively the
	 * opposite of expandBoundaries().
	 *
	 * If the boundaries are equal (collapsed), or become equal during this
	 * operation, or if until() returns true for either point, they may remain
	 * in start and end position respectively.
	 *
	 * @param {Cusor} start
	 * @param {Cusor} end
	 * @param {function:boolean} until
	 *        Optional predicate.  May be used to stop the trimming process from
	 *        moving the Cursor from within an element outside of it.
	 * @param {function:boolean} ignore
	 *        Optional predicate.  May be used to ignore (skip)
	 *        following/preceding siblings which otherwise would stop the
	 *        trimming process, like for example underendered whitespace.
	 */
	function trimBoundaries(start, end, until, ignore) {
		until = until || Fn.returnFalse;
		ignore = ignore || Fn.returnFalse;
		start.nextWhile(function (start) {
			return (
				!start.equals(end)
					&& (
						!start.atEnd
							? ignore(start.node)
							: !until(start.parent())
					)
			);
		});
		end.prevWhile(function (end) {
			var prevSibling = end.prevSibling();
			return (
				!start.equals(end)
					&& (
						prevSibling
							? ignore(prevSibling)
							: !until(end.parent())
					)
			);
		});
	}

	/**
	 * Collapses the given range's end boundary to the start.
	 *
	 * @param  {Range} range
	 * @return {Range}
	 */
	function collapseToStart(range) {
		range.setEnd(range.startContainer, range.startOffset);
		return range;
	}

	/**
	 * Collapses the given range's start boundary to the end.
	 *
	 * @param  {Range} range
	 * @return {Range}
	 */
	function collapseToEnd(range) {
		range.setStart(range.endContainer, range.endOffset);
		return range;
	}

	/**
	 * Return boundaries from the given range with cloned containers.
	 *
	 * @private
	 * @param  {Range} range
	 * @return {Array.<Boundary>}
	 */
	function clonedBoundaries(range) {
		var cac = range.commonAncestorContainer;
		var root = Dom.clone(cac, true);
		var startPath = Paths.fromBoundary(cac, Boundaries.fromRangeStart(range));
		var endPath = Paths.fromBoundary(cac, Boundaries.fromRangeEnd(range));
		return [
			Paths.toBoundary(root, startPath),
			Paths.toBoundary(root, endPath)
		];
	}

	/**
	 *
	 * @private
	 * @param  {Range} range
	 * @return {?Range}
	 */
	function expandLeft(range) {
		var boundaries = clonedBoundaries(range);
		var start = trimPreceedingNodes(boundaries[0]);
		var end = boundaries[1];
		if (Boundaries.isAtStart(start)) {
			return null;
		}
		if (Html.hasLinebreakingStyle(Boundaries.prevNode(start))) {
			return null;
		}
		var prev = Traversing.prev(start, 'char')
		        || Traversing.prev(start, 'boundary');
		return fromBoundaries(prev, end);
	}

	/**
	 *
	 * @private
	 * @param  {Range} range
	 * @return {?Range}
	 */
	function expandRight(range) {
		var boundaries = clonedBoundaries(range);
		var start = boundaries[0];
		var end = boundaries[1];
		if (Boundaries.isAtEnd(end)) {
			return null;
		}
		if (Html.hasLinebreakingStyle(Boundaries.nextNode(end))) {
			return null;
		}
		// Petro: I still don't understand this check :(
		if (!Html.isAtStart(end)) {
			return null;
		}
		var next = Traversing.next(end, 'char')
		        || Traversing.next(end, 'boundary');
		return fromBoundaries(start, next);
	}

	/**
	 * Returns a mutable bounding client rectangle for the given range.
	 *
	 * @private
	 * @param  {Range} range
	 * @return {Object<string, number>}
	 */
	function boundingRect(range) {
		var rect = range.getBoundingClientRect();
		return {
			top    : rect.top,
			left   : rect.left,
			width  : rect.width,
			height : rect.height
		};
	}

	/**
	 * Attempts to calculates the bounding rectangle offsets for the given
	 * range.
	 *
	 * This function is a hack to work around the problems that user agents have
	 * in determining the bounding client rect for collapsed ranges.
	 *
	 * @private
	 * @param  {Range} range
	 * @return {Object.<string, number>}
	 */
	function bounds(range) {
		var rect;
		var expanded = expandRight(range);
		if (expanded) {
			 rect = boundingRect(expanded);
			 if (rect.width > 0) {
				return rect;
			 }
		}
		expanded = expandLeft(range);
		if (expanded) {
			rect = boundingRect(expanded);
			rect.left += rect.width;
			return rect;
		}
		return {
			top    : 0,
			left   : 0,
			width  : 0,
			height : 0
		};
	}

	/**
	 * Gets the bounding box of offets for the given range.
	 *
	 * @param  {Range} range
	 * @return {Object.<string, number>}
	 */
	function box(range) {
		var rect = bounds(range);
		// Because `rect` should be the box of an expanded range and must
		// therefore have a non-zero width if valid
		if (rect.width > 0) {
			return rect;
		}
		var boundary = Boundaries.fromRangeStart(range);
		if (Boundaries.isAtEnd(boundary)) {
			return box(fromBoundaries(Traversing.prev(boundary), boundary));
		}
		var node = Boundaries.nodeAfter(boundary);
		if (!node) {
			return rect;
		}
		var scrollTop = Dom.scrollTop(node.ownerDocument);
		var scrollLeft = Dom.scrollLeft(node.ownerDocument);
		return {
			top    : node.parentNode.offsetTop - scrollTop,
			left   : node.parentNode.offsetLeft - scrollLeft,
			width  : node.offsetWidth,
			height : parseInt(Dom.getComputedStyle(node, 'line-height'), 10)
		};
	}

	/**
	 * Contracts the given range until it enters an editing host.
	 *
	 * Because in Firefox, the range may not be inside the editable even though
	 * the selection may be inside the editable.
	 *
	 * @param {Range} range
	 * @param {?Element} Editing host, or null if none is found
	 */
	function nearestEditingHost(range) {
		var editable = Dom.editingHost(range.startContainer);
		if (editable) {
			return editable;
		}
		var isNotEditingHost = Fn.complement(Dom.isEditingHost);
		var stable = StableRange(range);
		trim(stable, isNotEditingHost, isNotEditingHost);
		return Dom.editingHost(stable.startContainer);
	}

	/**
	 * Trims away unrendered nodes that preceed the given boundary. This
	 * trimming is done to fix a bug in Chrome which causes
	 * getBoundingClientRect() to return 0s.
	 *
	 * @private
	 * @param  {Boundary} boundary
	 * @return {Boundary}
	 */
	function trimPreceedingNodes(boundary) {
		if (Boundaries.isTextBoundary(boundary) || Boundaries.isAtStart(boundary)) {
			return boundary;
		}
		var node = Boundaries.nodeBefore(boundary);
		var newBoundary = boundary;
		var prev;
		while (node && Html.isUnrendered(node)) {
			newBoundary = Boundaries.fromNode(node);
			prev = node.previousSibling;
			Dom.remove(node);
			node = prev;
		}
		return newBoundary;
	}

	return {
		box                         : box,

		get                         : get,
		select                      : select,
		create                      : create,
		equals                      : equals,

		collapseToEnd               : collapseToEnd,
		collapseToStart             : collapseToStart,

		trim                        : trim,
		trimClosingOpening          : trimClosingOpening,
		trimBoundaries              : trimBoundaries,
		expandBoundaries            : expandBoundaries,

		nearestEditingHost          : nearestEditingHost,

		expand                      : expand,
		envelopeInvisibleCharacters : envelopeInvisibleCharacters,

		fromPosition                : fromPosition,
		fromBoundaries              : fromBoundaries
	};
});
