import * as React from "react";
import { PackagesModel } from "../models";
import { CondaPkgList, TitleItem } from "./CondaPkgList";
import { CondaPkgToolBar, PkgFilters } from "./CondaPkgToolBar";
import { CondaPkgStatusBar } from "./CondaPkgStatusBar";
import { showDialog } from "@jupyterlab/apputils";
import { style } from "typestyle";
import { INotification } from "jupyterlab_toastify";
export interface IPkgPanelProps {
  height: number;
  environment: string;
}

export interface IPkgPanelState {
  isLoading: boolean;
  isCheckingUpdate: boolean;
  isApplyingChanges: boolean;
  packages: PackagesModel.IPackages;
  selected: { [key: string]: PackagesModel.PkgStatus };
  activeFilter: PkgFilters;
  searchTerm: string;
  sortedField: TitleItem.SortField;
  sortDirection: TitleItem.SortStatus;
}

/** Top level React component for widget */
export class CondaPkgPanel extends React.Component<
  IPkgPanelProps,
  IPkgPanelState
> {
  constructor(props: IPkgPanelProps) {
    super(props);
    this.state = {
      isLoading: false,
      isCheckingUpdate: false,
      isApplyingChanges: false,
      packages: {},
      selected: {},
      searchTerm: null,
      activeFilter: PkgFilters.All,
      sortedField: TitleItem.SortField.Name,
      sortDirection: TitleItem.SortStatus.Down
    };

    this._model = new PackagesModel(this.props.environment);

    this.handleCategoryChanged = this.handleCategoryChanged.bind(this);
    this.handleClick = this.handleClick.bind(this);
    this.handleSearch = this.handleSearch.bind(this);
    this.handleApply = this.handleApply.bind(this);
    this.handleCancel = this.handleCancel.bind(this);
    this.handleSort = this.handleSort.bind(this);
  }

  private async _updatePackages() {
    if (!this.state.isLoading) {
      this.setState({
        isCheckingUpdate: false,
        isLoading: true
      });
      try {
        let environmentLoading = this._model.environment;
        let packages = await this._model.load();
        // If current environment changes when waiting for the packages
        if (this._model.environment !== environmentLoading) {
          this.setState({
            isLoading: false,
            packages: {},
            selected: {}
          });
          this._updatePackages();
          return;
        }
        this.setState({
          isLoading: false,
          isCheckingUpdate: true,
          packages: packages
        });
        // Now get the updatable packages
        let data = await this._model.conda_check_updates();
        // If current environment changes when waiting for the update status
        if (this._model.environment !== environmentLoading) {
          this.setState({
            isLoading: false,
            isCheckingUpdate: false,
            packages: {},
            selected: {}
          });
          this._updatePackages();
          return;
        }
        if (this.state.isCheckingUpdate) {
          data.updates.forEach(element => {
            let pkg = this.state.packages[element.name];
            if (pkg.status === PackagesModel.PkgStatus.Installed) {
              this.state.packages[element.name].updatable = true;
            }
          });
          this.setState({
            isCheckingUpdate: false,
            packages: this.state.packages
          });
        }
      } catch (error) {
        INotification.error(error.message);
      }
    }
  }

  handleCategoryChanged(event: any) {
    if (this.state.isApplyingChanges) {
      return;
    }

    this.setState({
      activeFilter: event.target.value
    });
  }

  handleClick(name: string) {
    if (this.state.isApplyingChanges) {
      return;
    }

    let clicked = this.state.packages[name];
    let selection = this.state.selected;

    if (clicked.status === PackagesModel.PkgStatus.Installed) {
      if (name in selection) {
        if (selection[name] === PackagesModel.PkgStatus.Update) {
          selection[name] = PackagesModel.PkgStatus.Remove;
        } else {
          delete selection[name];
        }
      } else {
        if (clicked.updatable) {
          selection[name] = PackagesModel.PkgStatus.Update;
        } else {
          selection[name] = PackagesModel.PkgStatus.Remove;
        }
      }
    } else if (clicked.status === PackagesModel.PkgStatus.Available) {
      if (name in selection) {
        delete selection[name];
      } else {
        selection[name] = PackagesModel.PkgStatus.Installed;
      }
    }
    this.setState({
      packages: this.state.packages,
      selected: selection
    });
  }

  handleSearch(event: any) {
    if (this.state.isApplyingChanges) {
      return;
    }

    this.setState({
      searchTerm: event.target.value
    });
  }

  /**
   * Execute requested task in the following order
   * 1. Remove packages
   * 2. Apply updates
   * 3. Install new packages
   */
  async handleApply() {
    if (this.state.isApplyingChanges) {
      return;
    }

    let toastId = null;
    try {
      this.setState({
        searchTerm: "",
        activeFilter: PkgFilters.Selected
      });

      let confirmation = await showDialog({
        title: "Packages actions",
        body: "Please confirm you want to apply the selected actions?"
      });

      if (confirmation.button.accept) {
        this.setState({
          isApplyingChanges: true
        });
        toastId = INotification.inProgress("Starting packages actions");
        let pkgs = Object.keys(this.state.selected).filter(
          name => this.state.selected[name] === PackagesModel.PkgStatus.Remove
        );
        if (pkgs.length > 0) {
          INotification.update({
            toastId: toastId,
            message: "Removing selected packages",
            buttons: []
          });
          await this._model.conda_remove(pkgs);
          // console.log(response);
        }
        pkgs = Object.keys(this.state.selected).filter(
          name => this.state.selected[name] === PackagesModel.PkgStatus.Update
        );
        if (pkgs.length > 0) {
          INotification.update({
            toastId: toastId,
            message: "Updating selected packages",
            buttons: []
          });
          await this._model.conda_update(pkgs);
        }
        pkgs = Object.keys(this.state.selected).filter(
          name =>
            this.state.selected[name] === PackagesModel.PkgStatus.Installed
        );
        if (pkgs.length > 0) {
          INotification.update({
            toastId: toastId,
            message: "Installing new packages",
            buttons: []
          });
          await this._model.conda_install(pkgs);
        }

        INotification.update({
          toastId: toastId,
          message: "Package actions successfully done.",
          type: "success",
          autoClose: 5000,
          buttons: []
        });
      }
    } catch (error) {
      if (toastId) {
        INotification.update({
          toastId: toastId,
          message: error.message,
          type: "error",
          autoClose: 5000,
          buttons: []
        });
      } else {
        toastId = INotification.error(error.message);
      }
    } finally {
      this.setState({
        isApplyingChanges: false,
        selected: {},
        activeFilter: PkgFilters.All
      });
      this._updatePackages();
    }
  }

  handleCancel() {
    if (this.state.isApplyingChanges) {
      return;
    }

    this.setState({
      selected: {}
    });
  }

  handleSort(field: TitleItem.SortField, status: TitleItem.SortStatus) {
    // TODO
    if (this.state.isApplyingChanges) {
      return;
    }
  }

  componentDidUpdate(prevProps: IPkgPanelProps) {
    if (prevProps.environment !== this.props.environment) {
      this._model = new PackagesModel(this.props.environment);
      this.setState({
        isCheckingUpdate: false,
        packages: {}
      });
      this._updatePackages();
    }
  }

  render() {
    let info = "";
    let nActions = Object.keys(this.state.selected).length;
    if (this.state.isLoading) {
      info = "Loading packages";
    } else if (this.state.isCheckingUpdate) {
      info = "Searching available updates";
    } else if (nActions > 0) {
      info = nActions + " packages selected";
    }

    let filteredPkgs: PackagesModel.IPackages = {};
    if (this.state.activeFilter === PkgFilters.All) {
      filteredPkgs = this.state.packages;
    } else if (this.state.activeFilter === PkgFilters.Installed) {
      Object.keys(this.state.packages).forEach(name => {
        let pkg = this.state.packages[name];
        if (pkg.status === PackagesModel.PkgStatus.Installed) {
          filteredPkgs[name] = pkg;
        }
      });
    } else if (this.state.activeFilter === PkgFilters.Available) {
      Object.keys(this.state.packages).forEach(name => {
        let pkg = this.state.packages[name];
        if (pkg.status === PackagesModel.PkgStatus.Available) {
          filteredPkgs[name] = pkg;
        }
      });
    } else if (this.state.activeFilter === PkgFilters.Updatable) {
      Object.keys(this.state.packages).forEach(name => {
        let pkg = this.state.packages[name];
        if (pkg.updatable) {
          filteredPkgs[name] = pkg;
        }
      });
    } else if (this.state.activeFilter === PkgFilters.Selected) {
      Object.keys(this.state.selected).forEach(name => {
        let pkg = this.state.packages[name];
        filteredPkgs[name] = pkg;
      });
    }

    let searchPkgs: PackagesModel.IPackages = {};
    if (this.state.searchTerm === null) {
      searchPkgs = filteredPkgs;
    } else {
      Object.keys(filteredPkgs).forEach(name => {
        if (name.indexOf(this.state.searchTerm) > -1) {
          searchPkgs[name] = filteredPkgs[name];
        }
      });
    }

    return (
      <div className={Style.Panel}>
        <CondaPkgToolBar
          category={this.state.activeFilter}
          hasSelection={Object.keys(this.state.selected).length > 0}
          onCategoryChanged={this.handleCategoryChanged}
          onSearch={this.handleSearch}
          onApply={this.handleApply}
          onCancel={this.handleCancel}
        />
        <CondaPkgList
          height={this.props.height - 28 - 26 - 29 - 4} // Remove height for top and bottom elements
          isPending={this.state.isLoading || this.state.isCheckingUpdate}
          sortedBy={this.state.sortedField}
          sortDirection={this.state.sortDirection}
          packages={searchPkgs}
          selection={this.state.selected}
          onPkgClick={this.handleClick}
          onSort={this.handleSort}
        />
        <CondaPkgStatusBar isLoading={false} infoText={info} />
      </div>
    );
  }

  private _model: PackagesModel;
}

namespace Style {
  export const Panel = style({
    flexGrow: 3,
    borderLeft: "1px solid var(--jp-border-color2)"
  });
}
