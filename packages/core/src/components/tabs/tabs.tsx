/*
 * Copyright 2015 Palantir Technologies, Inc. All rights reserved.
 * Licensed under the Apache License, Version 2.0 - http://www.apache.org/licenses/LICENSE-2.0
 */

import * as classNames from "classnames";
import * as PureRender from "pure-render-decorator";
import * as React from "react";
import { findDOMNode } from "react-dom";

import { AbstractComponent } from "../../common/abstractComponent";
import * as Classes from "../../common/classes";
import * as Errors from "../../common/errors";
import * as Keys from "../../common/keys";
import { IProps } from "../../common/props";
import * as Utils from "../../common/utils";

import { ITabProps, Tab } from "./tab";
import { ITabListProps, TabList } from "./tabList";
import { ITabPanelProps, TabPanel } from "./tabPanel";

export interface ITabsProps extends IProps {
    /**
     * The index of the initially selected tab when this component renders.
     * This prop has no effect if `selectedTabIndex` is also provided.
     * @default 0
     */
    initialSelectedTabIndex?: number;

    /**
     * The index of the currently selected tab.
     * Use this prop if you want to explicitly control the currently displayed panel
     * yourself with the `onChange` event handler.
     * If this prop is left undefined, the component changes tab panels automatically
     * when tabs are clicked.
     */
    selectedTabIndex?: number;

    /**
     * A callback function that is invoked when tabs in the tab list are clicked.
     */
    onChange?(selectedTabIndex: number, prevSelectedTabIndex: number): void;
}

export interface ITabsState {
    /**
     * The list of CSS rules to use on the indicator wrapper of the tab list.
     */
    indicatorWrapperStyle?: React.CSSProperties;

    /**
     * The index of the currently selected tab.
     * If a prop with the same name is set, this bit of state simply aliases the prop.
     */
    selectedTabIndex?: number;
}

const TAB_CSS_SELECTOR = "li[role=tab]";

@PureRender
export class Tabs extends AbstractComponent<ITabsProps, ITabsState> {
    public static defaultProps: ITabsProps = {
        initialSelectedTabIndex: 0,
    };

    public displayName = "Blueprint.Tabs";
    public state: ITabsState = {
        selectedTabIndex: Tabs.defaultProps.initialSelectedTabIndex,
    };

    private panelIds: string[] = [];
    private tabIds: string[] = [];

    private moveTimeout: number;

    constructor(props?: ITabsProps, context?: any) {
        super(props, context);
        this.state = this.getStateFromProps(this.props);
    }

    public render() {
        return (
            <div
                className={classNames(Classes.TABS, this.props.className)}
                onClick={this.handleClick}
                onKeyPress={this.handleKeyPress}
                onKeyDown={this.handleKeyDown}
            >
                {this.getChildren()}
            </div>
        );
    }

    public componentWillReceiveProps(newProps: ITabsProps & { children?: React.ReactNode }) {
        const newState = this.getStateFromProps(newProps);
        const index = newState.selectedTabIndex;
        if (index !== this.state.selectedTabIndex) {
            const oldTabsChildren = this.getTabChildrenFromProps(this.props);
            const newTabsChildren = this.getTabChildrenFromProps(newProps);
            const diffChildren = oldTabsChildren.filter((child, idx) => child !== newTabsChildren[idx]);
            if (diffChildren.length > 0) {
                this.forceUpdate(() => { this.setIndicatorAtIndex(index); });
            } else { this.setIndicatorAtIndex(index); }
        } else { this.setState(newState); }
    }

    public componentDidMount() {
        const selectedTab = findDOMNode(this.refs[`tabs-${this.state.selectedTabIndex}`]) as HTMLElement;
        this.moveTimeout = setTimeout(() => this.moveIndicator(selectedTab));
    }

    public componentWillUnmount() {
        clearTimeout(this.moveTimeout);
    }

    protected validateProps(props: ITabsProps & { children?: React.ReactNode }) {
        if (React.Children.count(props.children) > 0) {
            const child = React.Children.toArray(props.children)[0] as React.ReactElement<any>;
            if (child != null && child.type !== TabList) {
                throw new Error(Errors.TABS_FIRST_CHILD);
            }

            if (this.getTabsCount() !== this.getPanelsCount()) {
                throw new Error(Errors.TABS_MISMATCH);
            }
        }
    }

    private handleClick = (e: React.SyntheticEvent<HTMLDivElement>) => {
        this.handleTabSelectingEvent(e);
    }

    private handleKeyPress = (e: React.KeyboardEvent<HTMLDivElement>) => {
        const insideTab = (e.target as HTMLElement).closest(`.${Classes.TAB}`) != null;
        if (insideTab && (e.which === Keys.SPACE || e.which === Keys.ENTER)) {
            e.preventDefault();
            this.handleTabSelectingEvent(e);
        }
    }

    private handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        // don't want to handle keyDown events inside a tab panel
        const insideTabList = (e.target as HTMLElement).closest(`.${Classes.TAB_LIST}`) != null;
        if (!insideTabList) { return; }

        const focusedTabIndex = this.getFocusedTabIndex();
        if (focusedTabIndex === -1) { return; }

        if (e.which === Keys.ARROW_LEFT) {
            e.preventDefault();

            // find previous tab that isn't disabled
            let newTabIndex = focusedTabIndex - 1;
            let tabIsDisabled = this.isTabDisabled(newTabIndex);

            while (tabIsDisabled && newTabIndex !== -1) {
                newTabIndex--;
                tabIsDisabled = this.isTabDisabled(newTabIndex);
            }

            if (newTabIndex !== -1) {
                this.focusTab(newTabIndex);
            }
        } else if (e.which === Keys.ARROW_RIGHT) {
            e.preventDefault();

            // find next tab that isn't disabled
            const tabsCount = this.getTabsCount();

            let newTabIndex = focusedTabIndex + 1;
            let tabIsDisabled = this.isTabDisabled(newTabIndex);

            while (tabIsDisabled && newTabIndex !== tabsCount) {
                newTabIndex++;
                tabIsDisabled = this.isTabDisabled(newTabIndex);
            }

            if (newTabIndex !== tabsCount) {
                this.focusTab(newTabIndex);
            }
        }
    }

    private handleTabSelectingEvent = (e: React.SyntheticEvent<HTMLDivElement>) => {
        const tabElement = (e.target as HTMLElement).closest(TAB_CSS_SELECTOR) as HTMLElement;

        // select only if Tab is one of us and is enabled
        if (tabElement != null
                && this.tabIds.indexOf(tabElement.id) >= 0
                && tabElement.getAttribute("aria-disabled") !== "true") {
            const index = tabElement.parentElement.queryAll(TAB_CSS_SELECTOR).indexOf(tabElement);

            this.moveIndicator(tabElement);
            this.setSelectedTabIndex(index);
        }
    }

    private setIndicatorAtIndex(index: number) {
        const tabElement = findDOMNode(this.refs[`tabs-${index}`]) as HTMLElement;
        this.moveIndicator(tabElement);
        this.setState({ selectedTabIndex: index });
        if (Utils.isFunction(this.props.onChange)) {
            this.props.onChange(index, this.state.selectedTabIndex);
        }
    }

    /**
     * Calculate the new height, width, and position of the tab indicator.
     * Store the CSS values so the transition animation can start.
     */
    private moveIndicator({ clientHeight, clientWidth, offsetLeft, offsetTop }: HTMLElement) {
        const indicatorWrapperStyle = {
            height: clientHeight,
            transform: `translateX(${Math.floor(offsetLeft)}px) translateY(${Math.floor(offsetTop)}px)`,
            width: clientWidth,
        };
        this.setState({ indicatorWrapperStyle });
    }

    /**
     * Most of the component logic lives here. We clone the children provided by the user to set up refs,
     * accessibility attributes, and selection props correctly.
     */
    private getChildren() {
        for (let unassignedTabs = this.getTabsCount() - this.tabIds.length; unassignedTabs > 0; unassignedTabs--) {
            this.tabIds.push(generateTabId());
            this.panelIds.push(generatePanelId());
        }

        let childIndex = 0;
        return React.Children.map(this.props.children, (child: React.ReactElement<any>) => {
            let result: React.ReactElement<any>;

            // can be null if conditionally rendering TabList / TabPanel
            if (child == null) {
                return null;
            }

            if (childIndex === 0) {
                // clone TabList / Tab elements
                result = this.cloneTabList(child);
            } else {
                const tabPanelIndex = childIndex - 1;
                const shouldRenderTabPanel = this.state.selectedTabIndex === tabPanelIndex;
                result = shouldRenderTabPanel ? this.cloneTabPanel(child, tabPanelIndex) : null;
            }

            childIndex++;
            return result;
        });
    }

    private cloneTabList(child: React.ReactElement<ITabListProps & { children?: React.ReactNode }>) {
        let tabIndex = 0;
        const tabs = React.Children.map(child.props.children, (tab: React.ReactElement<any>) => {
            // can be null if conditionally rendering Tab
            if (tab == null) {
                return null;
            }

            const clonedTab = React.cloneElement(tab, {
                id: this.tabIds[tabIndex],
                isSelected: this.state.selectedTabIndex === tabIndex,
                panelId: this.panelIds[tabIndex],
                ref: `tabs-${tabIndex}`,
            } as ITabProps);
            tabIndex++;
            return clonedTab;
        });
        return React.cloneElement(child, {
            children: tabs,
            indicatorWrapperStyle: this.state.indicatorWrapperStyle,
            ref: "tablist",
        } as ITabListProps);
    }

    private cloneTabPanel(child: React.ReactElement<any>, tabIndex: number) {
        return React.cloneElement(child, {
            id: this.panelIds[tabIndex],
            isSelected: this.state.selectedTabIndex === tabIndex,
            ref: `panels-${tabIndex}`,
            tabId: this.tabIds[tabIndex],
        } as ITabPanelProps);
    }

    private focusTab(index: number) {
        const ref = `tabs-${index}`;
        const tab = findDOMNode(this.refs[ref]) as HTMLElement;
        tab.focus();
    }

    private getFocusedTabIndex() {
        const focusedElement = document.activeElement;
        if (focusedElement != null && focusedElement.classList.contains(Classes.TAB)) {
            const tabId = focusedElement.id;
            return this.tabIds.indexOf(tabId);
        }
        return -1;
    }

    private getTabs() {
        if (this.props.children == null) {
            return [];
        }
        let tabs: React.ReactElement<ITabProps>[] = [];
        if (React.Children.count(this.props.children) > 0) {
            const firstChild = React.Children.toArray(this.props.children)[0] as React.ReactElement<any>;
            if (firstChild != null) {
                React.Children.forEach(firstChild.props.children, (tabListChild: React.ReactElement<any>) => {
                    if (tabListChild.type === Tab) {
                        tabs.push(tabListChild);
                    }
                });
            }
        }
        return tabs;
    }

    private getTabsCount() {
        return this.getTabs().length;
    }

    private getPanelsCount() {
        if (this.props.children == null) {
            return 0;
        }

        let index = 0;
        let panelCount = 0;
        React.Children.forEach(this.props.children, (child: React.ReactElement<any>) => {
            if (child.type === TabPanel) {
                panelCount++;
            }
            index++;
        });

        return panelCount;
    }

    private getStateFromProps(props: ITabsProps): ITabsState {
        const { selectedTabIndex, initialSelectedTabIndex } = props;

        if (this.isValidTabIndex(selectedTabIndex)) {
            return { selectedTabIndex };
        } else if (this.isValidTabIndex(initialSelectedTabIndex)) {
            return { selectedTabIndex: initialSelectedTabIndex };
        } else {
            return this.state;
        }
    }

    private getTabChildrenFromProps(props: ITabsProps & { children?: React.ReactNode }) {
        const tabs = (React.Children.toArray(props.children)[0] as React.ReactElement<HTMLElement>).props.children;
        return React.Children.map(tabs, (tab: React.ReactElement<HTMLElement>) => tab.props.children);
    }

    private isTabDisabled(index: number) {
        const tab = this.getTabs()[index];
        return tab != null && tab.props.isDisabled;
    }

    private isValidTabIndex(index: number) {
        return index != null && index >= 0 && index < this.getTabsCount();
    }

    /**
     * Updates the component's state if uncontrolled and calls onChange.
     */
    private setSelectedTabIndex(index: number) {
        if (index === this.state.selectedTabIndex || !this.isValidTabIndex(index)) {
            return;
        }

        const prevSelectedIndex = this.state.selectedTabIndex;

        if (this.props.selectedTabIndex == null) {
            this.setState({
                selectedTabIndex: index,
            });
        }

        if (Utils.isFunction(this.props.onChange)) {
            this.props.onChange(index, prevSelectedIndex);
        }
    }
}

let tabCount = 0;
function generateTabId() {
    return `pt-tab-${tabCount++}`;
}

let panelCount = 0;
function generatePanelId() {
    return `pt-tab-panel-${panelCount++}`;
}

export var TabsFactory = React.createFactory(Tabs);
