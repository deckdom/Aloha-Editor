(function (aloha) {
	'use strict';
	
	var Fn = aloha.fn;
	var Dom = aloha.dom;
	var Keys = aloha.keys;
	var Editor = aloha.editor;
	var Events = aloha.events;
	var Editing = aloha.editing;
	var Overrides = aloha.overrides;
	var Selections = aloha.selections;
	var Boundaries = aloha.boundaries;
	var Traversing = aloha.traversing;
	var Arrays = aloha.arrays;
	var ACTION_CLASS_PREFIX = 'aloha-action-';

	/**
	 * jQuery-like wrapper for document.querySelectorAll
	 * Will accept a selector string and return an array
	 * of found DOM nodes or an empty array
	 *
	 * @param  {string} selector
	 * @return {Array.<Element>}
	 */
	function _$(selector) {
		return Arrays.coerce(document.querySelectorAll(selector));
	}

	/**
	 * Attaches event handlers to an array of elements.
	 *
	 * @param {Array.<Element>} elements
	 * @param {string}          event
	 * @param {function}        handler
	 */
	function on(elements, event, handler) {
		elements.forEach(function (element) {
			Events.add(element, event, handler);
		});
	}

	/**
	 * Adds a class from an array of elements.
	 *
	 * @param {Array.<Element>} elements
	 * @param {string}          className
	 */
	function addClass(elements, className) {
		elements.forEach(function (element) {
			Dom.addClass(element, className);
		});
	}

	/**
	 * Removes a class from an array of elements.
	 *
	 * @param {Array.<Element>} elements
	 * @param {string}          className
	 */
	function removeClass(elements, className) {
		elements.forEach(function (element) {
			Dom.removeClass(element, className);
		});
	}

	/**
	 * Updates an attribute for an array of elements.
	 *
	 * @param {Array.<Element>} elements
	 * @param {string}          name
	 * @param {string}          value
	 */
	function setAttr(elements, name, value) {
		elements.forEach(function (element) {
			Dom.setAttr(element, name, value);
		});
	}

	/**
	 * Executes an action based on the given parameters list
	 *
	 * @private
	 * @param  {!Array.<string>}   params
	 * @param  {!Array.<Boundary>} boundaries
	 * @return {Array.<Boundary>}
	 */
	function execute(params, boundaries) {
		var action = params.shift();
		return actions[action]
		     ? actions[action].apply(window, boundaries.concat(params))
		     : boundaries;
	}

	/**
	 * Parse an element and it's parent elements
	 * whether an aloha-action-* class name is present.
	 * An array will be returned, containing the whole
	 * matching class at index 0, and the parameters
	 * split by dash as the following keys.
	 *
	 * @private
	 * @param  {!Element} element
	 * @return {Array.<string>}
	 */
	function parseActionParams(element) {
		var match;
		var parameters = [];
		Dom.childAndParentsUntil(element, function (element) {
			if (element.className) {
				match = element.className.match(/aloha-action-(\S+)/);
			}
			if (match || Dom.hasClass(element, 'aloha-ui')) {
				return true;
			}
			return false;
		});
		if (match) {
			parameters = match[1].split('-');
			parameters.unshift(match[0]);
		}
		return parameters;
	}

	/**
	 * Transforms an array of dom nodes into an array of node names
	 * for faster iteration, eg:
	 *
	 * [text, h1, text, p] // array contains DOM nodes
	 *
	 * will return:
	 *
	 * ['P', '#text', 'H1']
	 *
	 * Duplicate entries will be removed, as displayed in the example
	 * above.
	 *
	 * @private
	 * @param  {!Array.<Element>} nodes
	 * @return {Array.<string>}
	 */
	function uniqueNodeNames(nodes) {
		var i = nodes.length;
		var arr = [];
		var added = {};
		while (i--) {
			if (!added[nodes[i].nodeName]) {
				arr.push(nodes[i].nodeName);
				added[nodes[i].nodeName] = true;
			}
		}
		return arr;
	}

	/**
	 * Positions the given toolbar element to point to the anchor element in the
	 * document.
	 *
	 * @param {!Element} toolbar
	 * @param {!Element} anchor
	 */
	function positionToolbar(toolbar, anchor) {
		var box = aloha.carets.box(Boundaries.range(
			Boundaries.create(anchor, 0),
			Boundaries.create(anchor, 1)
		));
		var center = Math.round(box.left + (box.width / 2));
		var win = Dom.documentWindow(anchor.ownerDocument);
		var windowWidth = win.innerWidth;
		var toolbarWidth = parseInt(Dom.getComputedStyle(toolbar, 'width'), 10);
		var buffer = 10;
		var xMin = buffer;
		var xMax = (windowWidth - toolbarWidth) - buffer;
		var x = Math.min(xMax, Math.max(xMin, center - (toolbarWidth / 2)));
		var y = box.top + box.height + buffer;
		Dom.setStyle(toolbar, 'left', x + 'px');
		Dom.setStyle(toolbar, 'top', y + 'px');
		var arrow = toolbar.querySelector('.aloha-arrow-up');
		var arrowOffset = (x <= xMin || x >= xMax)
		                ? (center - x) + 'px'
		                : 'auto';
		Dom.setStyle(arrow, 'margin-left', arrowOffset);
	}

	function notAnchor(node) { return 'A' !== node.nodeName; }
	function hasClass(className, node) { return Dom.hasClass(node, className); }

	var LinksUI = {

		/**
		 * Opens the given context toolbar for editing the given anchor.
		 *
		 * @param {!Element} toolbar
		 * @param {!Element} anchor
		 */
		open: function (toolbar, anchor) {
			var href = Dom.getAttr(anchor, 'href');
			removeClass(_$('.aloha-active'), 'aloha-active');
			Dom.addClass(anchor, 'aloha-active');
			Dom.addClass(toolbar, 'opened');
			positionToolbar(toolbar, anchor);
			toolbar.querySelector('input').value = href;
			setAttr(_$('a.aloha-link-follow'), 'href', href);
		},

		/**
		 * Closes the context toolbar.
		 *
		 * @param {!Element} toolbar
		 * @param {!Element} anchor
		 */
		close: function(toolbar, anchor) {
			removeClass(_$('.aloha-active'), 'aloha-active');
			Dom.removeClass(toolbar, 'opened');
		},

		/**
		 * Retrieves a toolbar element from the given document if one exists.
		 *
		 * @param  {!Document} doc
		 * @return {?Element}
		 */
		toolbar: function (doc) {
			var toolbar = doc.querySelector('.aloha-link-toolbar');
			return (toolbar && Dom.hasClass(toolbar.parentNode, 'aloha-3d'))
				 ? toolbar.parentNode
				 : toolbar;
		},

		/**
		 * Resolves the anchor element from the boundaries
		 *
		 * @param  {Array.<Boundary>} boundaries
		 * @return {?Element}
		 */
		anchor: function (boundaries) {
			var cac = Boundaries.commonContainer(boundaries[0], boundaries[1]);
			return Dom.upWhile(cac, notAnchor);
		},

		/**
		 * Returns the element or its first ancestor that has a 'aloha-ui'
		 * class, if any.
		 *
		 * @param  {!Element} element
		 * @return {?Element}
		 */
		closestToolbar: function (element) {
			var toolbar = Dom.upWhile(element, Fn.complement(Fn.partial(hasClass, 'aloha-ui')));
			return (toolbar && Dom.hasClass(toolbar.parentNode, 'aloha-3d'))
				 ? toolbar.parentNode
				 : toolbar;
		},

		/**
		 * Handles user interaction on the context toolbar.
		 *
		 * @param {!Element} element
		 * @param {!Element} anchor
		 * @param {!Event}   event
		 */
		interact: function(toolbar, anchor) {
			setAttr(_$('a.aloha-active, a.aloha-link-follow'), 'href', toolbar.querySelector('input').value);
		},

		/**
		 * Normalize boundaries, so that if either start
		 * or end boundaries are inside an anchor tag
		 * both boundaries will snap to that tag.
		 * If the boundaries are collapsed, they will be
		 * extended to word.
		 *
		 * @param {!Boundaries} boundaries
		 * @return {Boundaries}
		 */
		normalize: function (boundaries) {
			var anchor;
			var i;
			function getAnchor (node) {
				if (node.nodeName === 'A') {
					anchor = node;
				}
			}
			for (i = 0; i < boundaries.length; i++) {
				Dom.childAndParentsUntilIncl(Boundaries.container(boundaries[i]), getAnchor);
				if (anchor) {
					return [Boundaries.next(Boundaries.fromNode(anchor)), Boundaries.fromEndOfNode(anchor)];
				}
			}

			if (Arrays.equal(boundaries[0], boundaries[1])) {
				return Traversing.expand(boundaries[0], boundaries[1], 'word');
			}

			return boundaries;
		},

		/**
		 * Inserts a link at the boundary position
		 *
		 * @param  {!Boundary}  start
		 * @param  {!Boundary}  end
		 * @return {Boundaries} event
		 */
		insertLink: function insertLink(start, end) {
			var boundaries = LinksUI.normalize([start, end]);
			if (Boundaries.container(boundaries[0]).nodeName !== 'A') {
				boundaries = Editing.wrap('A', boundaries[0], boundaries[1]);
				boundaries[0] = Boundaries.next(boundaries[0]);
				boundaries[1] = Boundaries.fromEndOfNode(boundaries[0])[0];
			}
			LinksUI.open(
				LinksUI.toolbar(document),
				Boundaries.container(boundaries[0])
			);
			_$('.aloha-link-toolbar input[name=href]')[0].focus();
			addClass(_$('.aloha-ui .' + ACTION_CLASS_PREFIX + 'A'), 'active');
			return boundaries;
		}
	};

	/**
	 * Links-specific UI handling.
	 *
	 * @param  {!Event} event
	 * @return {Event}
	 */
	function handleLinks(event) {
		var anchor = LinksUI.anchor(event.selection.boundaries);
		var toolbar = LinksUI.toolbar(event.nativeEvent.target.ownerDocument);
		if (!toolbar) {
			return;
		}
		if (anchor) {
			return LinksUI.open(toolbar, anchor);
		}
		if (toolbar === LinksUI.closestToolbar(event.nativeEvent.target)) {
			return LinksUI.interact(toolbar, anchor, event);
		}
		return LinksUI.close(toolbar, anchor);
	}

	/**
	 * Updates the ui according to current state overrides.
	 *
	 * Sets to active all ui toolbar elements that match the current overrides.
	 *
	 * @private
	 * @param {!Event} event
	 */
	function handleFormats(event) {
		var boundaries = event.selection.boundaries;
		var formatNodes = uniqueNodeNames(Dom.childAndParentsUntilIncl(
			Boundaries.container(boundaries[0]),
			function (node) {
				return node.parentNode && Dom.isEditingHost(node.parentNode);
			}
		));

		/**
		 * Finds the root ul of a bootstrap dropdown menu
		 * starting from an entry node within the menu.
		 * Returns true until the node is found. Meant to
		 * be used with Dom.upWhile().
		 *
		 * @private
		 * @param {!Node} node
		 * @return {boolean}
		 */
		function isDropdownUl(node) {
			return Array.prototype.indexOf.call(node.classList, 'dropdown-menu') === -1;
		}

		removeClass(_$('.aloha-ui .active'), 'active');

		formatNodes.forEach(function (format) {
			// update buttons
			var buttons = _$('.aloha-ui .' + ACTION_CLASS_PREFIX + format);
			var i = buttons.length;
			while (i--) {
				buttons[i].className += ' active';
			}

			// update dropdowns
			var dropdownEntries = _$('.aloha-ui .dropdown-menu .' + ACTION_CLASS_PREFIX + format);
			i = dropdownEntries.length;
			removeClass(_$('.aloha-ui .dropdown-toggle .active'), 'active');
			if (i > 0) {
				var parents = Dom.parentsUntilIncl(dropdownEntries[0], function (node) {
					return Dom.hasClass(node, 'btn-group');
				});
				var btnGroup = Arrays.last(parents);
				Dom.addClass(btnGroup.querySelector('.dropdown-toggle'), 'active');
			}
			var dropdownRoot;
			while (i--) {
				dropdownRoot = Dom.upWhile(dropdownEntries[i], isDropdownUl).parentNode;
				dropdownRoot.querySelector('.dropdown-toggle').firstChild.data =
					dropdownEntries[i].innerText + ' ';
			}
		});
	}

	/**
	 * Handles overrides toggling.
	 *
	 * @private
	 * @param {!Event} event
	 */
	function handleOverrides(event) {
		var overrides = Overrides.joinToSet(
			event.selection.formatting,
			event.selection.overrides
		);
		overrides.forEach(function (override) {
			var format = Overrides.stateToNode[override[0]];
			if (format) {
				var btns = _$('.aloha-ui .' + ACTION_CLASS_PREFIX + format);
				if (override[1]) {
					addClass(btns, 'active');
				} else {
					removeClass(btns, 'active');
				}
			}
		});
	}

	var eventLoop = { inEditable: false };

	on([document], 'mousedown', function (event) {
		eventLoop.inEditable = false;
	});

	on([document], 'mouseup', function (event) {
		if (eventLoop.inEditable) {
			return;
		}
		var ui = Dom.upWhile(event.target, function (node) {
			return !Dom.hasClass(node, 'aloha-ui');
		});
		if (!ui) {
			Editor.selection = null;
			removeClass(_$('.aloha-ui .active'), 'active');
		}
	});

	on(_$('.aloha-ui'), 'mousedown', function (event) {
		if (event.target.nodeName === 'INPUT') {
			return;
		}
		var actionParams = parseActionParams(event.target);
		if (actionParams && Editor.selection) {
			var boundaries = execute(actionParams, Editor.selection.boundaries);
			Selections.select(
				Editor.selection,
				boundaries[0],
				boundaries[1],
				Editor.selection.focus
			);
		}
	});

	on(_$('.aloha-link-toolbar input[name=href]'), 'keyup', function (event) {
		if (Editor.selection) {
			LinksUI.interact(
				LinksUI.toolbar(event.target.ownerDocument),
				LinksUI.anchor(Editor.selection.boundaries)
			);
		}
	});
	
	// make .aloha-sticky-top items stick to the top when scrolling
	on([window], 'scroll', function (event) {
		var stickies = _$('.aloha-sticky-top');
		var scrollTop = Dom.scrollTop(document);
		stickies.forEach(function (element) {
			if (Dom.hasClass(element, 'aloha-sticky-top-active')) {
				if (scrollTop <= Dom.getAttr(element, 'data-aloha-sticky-top-pos')) {
					Dom.setAttr(element, 'data-aloha-sticky-top-pos', null);
					Dom.removeClass(element, 'aloha-sticky-top-active');
				}
			} else {
				if (scrollTop > Dom.absoluteTop(element)) {
					Dom.setAttr(element, 'data-aloha-sticky-top-pos', Dom.absoluteTop(element));
					Dom.addClass(element, 'aloha-sticky-top-active');
				}
			}
		});
	});	

	var shortcuts = {
		'keydown': {
			'meta+k' : LinksUI.insertLink,
			'ctrl+k' : LinksUI.insertLink
		}
	};

	var actions = {
		'aloha-action-B'       : Editing.format,
		'aloha-action-I'       : Editing.format,
		'aloha-action-H2'      : Editing.format,
		'aloha-action-H3'      : Editing.format,
		'aloha-action-H4'      : Editing.format,
		'aloha-action-P'       : Editing.format,
		'aloha-action-PRE'     : Editing.format,
		'aloha-action-OL'      : Editing.format,
		'aloha-action-UL'      : Editing.format,
		'aloha-action-A'       : LinksUI.insertLink,
		'aloha-action-unformat': function (start, end) {
			var boundaries = [start, end];
			['B', 'I', 'U'].forEach(function (format) {
				boundaries = Editing.unformat(
					boundaries[0],
					boundaries[1],
					format
				);				
			});
			return boundaries;
		}
	};

	/**
	 * Handles UI updates invoked by event
	 *
	 * @param  {!Event} event
	 * @return {Event}
	 */
	function handleUi(event) {
		var handler = Keys.shortcutHandler(event, shortcuts);
		if (handler) {
			event.selection.boundaries = handler(
				event.selection.boundaries[0], 
				event.selection.boundaries[1]
			);
			if (handler.name === 'insertLink') {
				event.preventSelection = true;
			}
			return event;
		}
		if ('mouseup' === event.type || 'aloha.mouseup' === event.type) {
			eventLoop.inEditable = true;
		} else if ('keydown' === event.type) {
			handleFormats(event);
			handleOverrides(event);
		} else if ('keyup' === event.type || 'click' === event.type) {
			handleLinks(event);
			handleFormats(event);
			handleOverrides(event);
		}
		return event;
	}

	aloha.editor.stack.unshift(handleUi);
}(window.aloha));
