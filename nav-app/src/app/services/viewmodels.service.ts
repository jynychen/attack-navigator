import { EventEmitter, Injectable, Output } from '@angular/core';
import { Gradient, TechniqueVM, ViewModel } from '../classes';
import { DataService } from './data.service';
import { evaluate } from 'mathjs';
import { isBoolean, isNumber } from '../utils/utils';

@Injectable({
    providedIn: 'root',
})
export class ViewModelsService {
    @Output() onSelectionChange = new EventEmitter<any>();

    public viewModels: ViewModel[] = [];
    public pinnedCell: string = '';
    private nonce: number = 0;

    constructor(private dataService: DataService) {
        // intentionally left blank
    }

    /* Emit event when technique selection changes */
    public selectionChanged(): void {
        this.onSelectionChange.emit();
    }

    /**
     * Create and return a new viewModel
     * @param {string} name the viewmodel name
     * @param {string} domainVersionID the ID of the domain & version
     * @return {ViewModel} the created ViewModel
     */
    public newViewModel(name: string, domainVersionID: string): ViewModel {
        let vm = new ViewModel(name, 'vm' + this.getNonce(), domainVersionID, this.dataService);
        this.viewModels.push(vm);
        return vm;
    }

    /**
     * Get a nonce.
     * @return a number that will never be regenerated by sequential calls to getNonce.
     * Note: this applies on a session-by-session basis, nonces are not
     * unique between app instances.
     */
    public getNonce(): number {
        return this.nonce++;
    }

    /**
     * Destroy the viewmodel
     * @param vm viewmodel to destroy.
     */
    public destroyViewModel(vm: ViewModel): void {
        for (let i = 0; i < this.viewModels.length; i++) {
            if (this.viewModels[i] == vm) {
                this.viewModels.splice(i, 1);
                return;
            }
        }
    }

    /**
     * Layer combination operation
     * @param  scoreVariables   variables in math expression, mapping to viewmodel they correspond to
     * @param  layerName        the name of the new layer
     * @param  opSettings       the settings for view model inheritance
     *      - `domain`: the domain & version
     *      - `gradientVM`: the view model to inherit gradient from
     *      - `coloringVM`: the view model to inherit manual colors from
     *      - `commentVM`: the view model to inherit comments from
     *      - `linkVM`: the view model to inherit links from
     *      - `metadataVM`: the view model to inherit metadata from
     *      - `enabledVM`: the view model to inherit enabled state from
     *      - `filterVM`: the view model to inherit filters from
     *      - `scoreExpression`: math equation of score expression
     *      - `legendVM`: the view model to inherit legend items from
     * @return                  new viewmodel inheriting above properties
     */
    public layerOperation(scoreVariables: Map<string, ViewModel>, layerName: string, opSettings: any): ViewModel {
        let newViewModel = new ViewModel('layer by operation', 'vm' + this.getNonce(), opSettings.domain, this.dataService);

        if (opSettings.scoreExpression) {
            opSettings.scoreExpression = opSettings.scoreExpression.toLowerCase(); // should be enforced by input, but just in case
            let minScore = Infinity;
            let maxScore = -Infinity;

            // get list of all technique IDs used in the VMs
            let techniqueIDs = new Set<string>();
            scoreVariables.forEach((vm) => {
                vm.techniqueVMs.forEach(function (techniqueVM, techniqueID) {
                    techniqueIDs.add(techniqueID);
                });
            });

            // attempt to evaluate without a scope to catch the case of a static assignment
            try {
                // evaluate with an empty scope
                let result = evaluate(opSettings.scoreExpression, {});

                // if it didn't except after this, it evaluated to a single result
                console.debug('score expression evaluated to single result to be applied to all techniques');
                if (isBoolean(result)) {
                    // boolean to binary
                    result = result ? '1' : '0';
                } else if (!isNumber(result)) {
                    // unexpected user input
                    throw Error('math result ( ' + result + ' ) is not a number');
                }

                // apply result to all techniques
                newViewModel.initializeScoresTo = String(result);
                minScore = result;
                maxScore = result;
            } catch (err) {
                //couldn't evaluate with empty scope, build scope for each technique
                // compute the score of each techniqueID
                techniqueIDs.forEach((techniqueID) => {
                    let newTechniqueVM = new TechniqueVM(techniqueID);
                    let scope = {};
                    let misses = 0; // number of times a VM is missing the value
                    scoreVariables.forEach(function (vm, key) {
                        let scoreValue: number;
                        if (!vm.hasTechniqueVM_id(techniqueID)) {
                            // missing technique
                            scoreValue = 0;
                            misses++;
                        } else {
                            // technique exists
                            let score = vm.getTechniqueVM_id(techniqueID).score;
                            if (score == '' || isNaN(Number(score))) {
                                scoreValue = 0;
                                misses++;
                            } else {
                                scoreValue = Number(score);
                            }
                        }
                        scope[key] = scoreValue;
                    });

                    // did at least one technique have a score for this technique?
                    if (misses < scoreVariables.size) {
                        let mathResult = evaluate(opSettings.scoreExpression, scope);
                        if (isBoolean(mathResult)) {
                            // boolean to binary
                            mathResult = mathResult ? '1' : '0';
                        } else if (!isNumber(mathResult)) {
                            // unexpected user input
                            throw Error('math result ( ' + mathResult + ' ) is not a number');
                        }

                        newTechniqueVM.score = String(mathResult);
                        newViewModel.techniqueVMs.set(techniqueID, newTechniqueVM);
                        minScore = Math.min(minScore, mathResult);
                        maxScore = Math.max(maxScore, mathResult);
                    }
                    // don't record a result if none of VMs had a score for this technique
                });
            }

            // gradient doesn't apply if there is no range of values
            if (minScore != maxScore) {
                // set up gradient according to result range
                if (minScore != Infinity) newViewModel.gradient.minValue = minScore;
                if (maxScore != -Infinity) newViewModel.gradient.maxValue = maxScore;

                // if binary range, set to transparentblue gradient
                if (minScore == 0 && maxScore == 1) newViewModel.gradient.setGradientPreset('transparentblue');
            }
        }

        /**
         * Inherit a field from a vm
         * @param  {ViewModel} inheritVM the viewModel to inherit from
         * @param  {string}    fieldName  the field to inherit from the viewmodel
         */
        function inherit(inheritVM: ViewModel, fieldName: string) {
            inheritVM.techniqueVMs.forEach((techniqueVM) => {
                let tvm = newViewModel.hasTechniqueVM_id(techniqueVM.technique_tactic_union_id)
                    ? newViewModel.getTechniqueVM_id(techniqueVM.technique_tactic_union_id)
                    : new TechniqueVM(techniqueVM.technique_tactic_union_id);
                tvm[fieldName] = techniqueVM[fieldName];
                newViewModel.techniqueVMs.set(techniqueVM.technique_tactic_union_id, tvm);
            });
        }

        if (opSettings.commentVM) inherit(opSettings.commentVM, 'comment');
        if (opSettings.linkVM) inherit(opSettings.linkVM, 'links');
        if (opSettings.metadataVM) inherit(opSettings.metadataVM, 'metadata');
        if (opSettings.coloringVM) inherit(opSettings.coloringVM, 'color');
        if (opSettings.enabledVM) inherit(opSettings.enabledVM, 'enabled');

        if (opSettings.filterVM) {
            //copy filter settings
            newViewModel.filters.deserialize(JSON.parse(opSettings.filterVM.filters.serialize()));
        }

        if (opSettings.legendVM) {
            newViewModel.legendItems = JSON.parse(JSON.stringify(opSettings.legendVM.legendItems));
        }

        if (opSettings.gradientVM) {
            newViewModel.gradient = new Gradient();
            newViewModel.gradient.deserialize(opSettings.gradientVM.gradient.serialize());
        }

        newViewModel.name = layerName;
        this.viewModels.push(newViewModel);
        newViewModel.updateGradient();
        return newViewModel;
    }
}
