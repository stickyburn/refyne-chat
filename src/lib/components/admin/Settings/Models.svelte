<script lang="ts">
import fileSaver from 'file-saver';
import { marked } from 'marked';
const { saveAs } = fileSaver;

import { getContext, onMount, tick } from 'svelte';
const i18n = getContext('i18n');

import { page } from '$app/stores';
import {
	createNewModel,
	deleteAllModels,
	getBaseModels,
	getBaseModelTags,
	importModels,
	toggleModelById,
	updateModelById
} from '$lib/apis/models';
import { updateUserSettings } from '$lib/apis/users';
import { WEBUI_NAME, models as _models, config, mobile, settings, user } from '$lib/stores';
import { copyToClipboard } from '$lib/utils';

import { getModels } from '$lib/apis';
import Spinner from '$lib/components/common/Spinner.svelte';
import Switch from '$lib/components/common/Switch.svelte';
import Tooltip from '$lib/components/common/Tooltip.svelte';
import Search from '$lib/components/icons/Search.svelte';
import XMark from '$lib/components/icons/XMark.svelte';

import ModelEditor from '$lib/components/workspace/Models/ModelEditor.svelte';
import { toast } from 'svelte-sonner';
import Badge from '$lib/components/common/Badge.svelte';
import ConfirmDialog from '$lib/components/common/ConfirmDialog.svelte';
import Cog6 from '$lib/components/icons/Cog6.svelte';
import ModelSettingsModal from './Models/ModelSettingsModal.svelte';
import Wrench from '$lib/components/icons/Wrench.svelte';
import Download from '$lib/components/icons/Download.svelte';
import ManageModelsModal from './Models/ManageModelsModal.svelte';
import ModelMenu from '$lib/components/admin/Settings/Models/ModelMenu.svelte';
import EllipsisHorizontal from '$lib/components/icons/EllipsisHorizontal.svelte';
import EyeSlash from '$lib/components/icons/EyeSlash.svelte';
import Eye from '$lib/components/icons/Eye.svelte';
import CheckCircle from '$lib/components/icons/CheckCircle.svelte';
import Minus from '$lib/components/icons/Minus.svelte';
import { WEBUI_API_BASE_URL, WEBUI_BASE_URL } from '$lib/constants';
import { goto } from '$app/navigation';
import { DropdownMenu } from 'bits-ui';
import { flyAndScale } from '$lib/utils/transitions';
import Dropdown from '$lib/components/common/Dropdown.svelte';
import AdminViewSelector from './Models/AdminViewSelector.svelte';
import Pagination from '$lib/components/common/Pagination.svelte';
import TagSelector from '$lib/components/workspace/common/TagSelector.svelte';

type ModelListItem = { id: string; name?: string };

let shiftKey = false;

let modelsImportInProgress = false;
let importFiles;
let modelsImportInputElement: HTMLInputElement;

let models = null;

let workspaceModels: ModelListItem[] = [];
let baseModels: ModelListItem[] = [];

let filteredModels = [];
let selectedModelId = null;

let showConfigModal = false;
let showManageModal = false;

let viewOption = ''; // '' = All, 'enabled', 'disabled', 'visible', 'hidden'
let tags: string[] = [];
let selectedTag = '';

const perPage = 30;
let currentPage = 1;

const isPublicModel = (model) => {
	return (model?.access_grants ?? []).some(
		(g) => g.principal_type === 'user' && g.principal_id === '*' && g.permission === 'read'
	);
};

$: if (models) {
	filteredModels = models
		.filter((m) => searchValue === '' || m.name.toLowerCase().includes(searchValue.toLowerCase()))
		.filter((m) => {
			if (viewOption === 'enabled') return m?.is_active ?? true;
			if (viewOption === 'disabled') return !(m?.is_active ?? true);
			if (viewOption === 'visible') return !(m?.meta?.hidden ?? false);
			if (viewOption === 'hidden') return m?.meta?.hidden === true;
			if (viewOption === 'public') return isPublicModel(m);
			if (viewOption === 'private') return !isPublicModel(m);
			return true; // All
		})
		.sort((a, b) => {
			return (a?.name ?? a?.id ?? '').localeCompare(b?.name ?? b?.id ?? '');
		});
}

let searchValue = '';

$: if (searchValue || viewOption !== undefined) {
	currentPage = 1;
}

const enableAllHandler = async () => {
	const modelsToEnable = filteredModels.filter((m) => !(m.is_active ?? true));
	// Optimistic UI update
	modelsToEnable.forEach((m) => (m.is_active = true));
	models = models;
	// Sync with server
	await Promise.all(
		modelsToEnable.map((model) => upsertModelHandler(model, { is_active: true }, false))
	);

	await tick();
	await init();
};

const disableAllHandler = async () => {
	const modelsToDisable = filteredModels.filter((m) => m.is_active ?? true);
	// Optimistic UI update
	modelsToDisable.forEach((m) => (m.is_active = false));
	models = models;
	// Sync with server
	await Promise.all(
		modelsToDisable.map((model) => upsertModelHandler(model, { is_active: false }, false))
	);

	await tick();
	await init();
};

const showAllHandler = async () => {
	const modelsToShow = filteredModels.filter((m) => m?.meta?.hidden === true);
	// Optimistic UI update
	modelsToShow.forEach((m) => {
		m.meta = { ...m.meta, hidden: false };
	});
	models = models;
	// Sync with server
	await Promise.all(
		modelsToShow.map((model) =>
			upsertModelHandler(model, { meta: { ...model.meta, hidden: false } }, false)
		)
	);

	toast.success($i18n.t('All models are now visible'));
	await tick();
	await init();
};

const hideAllHandler = async () => {
	const modelsToHide = filteredModels.filter((m) => !(m?.meta?.hidden ?? false));
	// Optimistic UI update
	modelsToHide.forEach((m) => {
		m.meta = { ...m.meta, hidden: true };
	});
	models = models;
	// Sync with server
	await Promise.all(
		modelsToHide.map((model) =>
			upsertModelHandler(model, { meta: { ...model.meta, hidden: true } }, false)
		)
	);

	toast.success($i18n.t('All models are now hidden'));
	await tick();
	await init();
};

const downloadModels = async (models) => {
	let blob = new Blob([JSON.stringify(models)], {
		type: 'application/json'
	});
	saveAs(blob, `models-export-${Date.now()}.json`);
};

const init = async () => {
	models = null;

	tags = await getBaseModelTags(localStorage.token);
	if (selectedTag && !tags.includes(selectedTag)) {
		selectedTag = '';
	}

	workspaceModels = await getBaseModels(localStorage.token, selectedTag);
	baseModels = await getModels(localStorage.token, null, true);
	const workspaceModelIds = new Set<string>(workspaceModels.map((wm: ModelListItem) => wm.id));

	models = baseModels
		.filter((m: ModelListItem) => !selectedTag || workspaceModelIds.has(m.id))
		.map((m: ModelListItem) => {
			const workspaceModel = workspaceModels.find((wm: ModelListItem) => wm.id === m.id);

			if (workspaceModel) {
				return {
					...m,
					...workspaceModel
				};
			} else {
				return {
					...m,
					id: m.id,
					name: m.name,

					is_active: true
				};
			}
		});

	_models.set(
		await getModels(
			localStorage.token,
			$config?.features?.enable_direct_connections && ($settings?.directConnections ?? null)
		)
	);
};

const upsertModelHandler = async (model, overrides = {}, showToast = true) => {
	model = { ...model, base_model_id: null, ...overrides };

	if (workspaceModels.find((m) => m.id === model.id)) {
		const res = await updateModelById(localStorage.token, model.id, model).catch((error) => {
			return null;
		});

		if (res && showToast) {
			toast.success($i18n.t('Model updated successfully'));
		}
	} else {
		const res = await createNewModel(localStorage.token, {
			meta: {},
			id: model.id,
			name: model.name,
			base_model_id: null,
			params: {},
			access_grants: [],
			...model
		}).catch((error) => {
			return null;
		});

		if (res && showToast) {
			toast.success($i18n.t('Model updated successfully'));
			await init();
		}
	}
};

const toggleModelHandler = async (model) => {
	if (!Object.keys(model).includes('base_model_id')) {
		await createNewModel(localStorage.token, {
			id: model.id,
			name: model.name,
			base_model_id: null,
			meta: {},
			params: {},
			access_grants: [],
			is_active: model.is_active
		}).catch((error) => {
			return null;
		});
	} else {
		await toggleModelById(localStorage.token, model.id);
	}

	// await init();
	_models.set(
		await getModels(
			localStorage.token,
			$config?.features?.enable_direct_connections && ($settings?.directConnections ?? null)
		)
	);
};

const hideModelHandler = async (model) => {
	model.meta = {
		...model.meta,
		hidden: !(model?.meta?.hidden ?? false)
	};

	console.debug(model);

	upsertModelHandler(model, { meta: model.meta }, false);

	toast.success(
		model.meta.hidden
			? $i18n.t(`Model {{name}} is now hidden`, {
					name: model.id
				})
			: $i18n.t(`Model {{name}} is now visible`, {
					name: model.id
				})
	);
};

const copyLinkHandler = async (model) => {
	const baseUrl = window.location.origin;
	const res = await copyToClipboard(`${baseUrl}/?model=${encodeURIComponent(model.id)}`);

	if (res) {
		toast.success($i18n.t('Copied link to clipboard'));
	} else {
		toast.error($i18n.t('Failed to copy link'));
	}
};

const cloneHandler = async (model) => {
	sessionStorage.model = JSON.stringify({
		...model,
		base_model_id: model.id,
		id: `${model.id}-clone`,
		name: `${model.name} (Clone)`
	});
	goto('/workspace/models/create');
};

const exportModelHandler = async (model) => {
	let blob = new Blob([JSON.stringify([model])], {
		type: 'application/json'
	});
	saveAs(blob, `${model.id}-${Date.now()}.json`);
};

const pinModelHandler = async (modelId) => {
	let pinnedModels = $settings?.pinnedModels ?? [];

	if (pinnedModels.includes(modelId)) {
		pinnedModels = pinnedModels.filter((id) => id !== modelId);
	} else {
		pinnedModels = [...new Set([...pinnedModels, modelId])];
	}

	settings.set({ ...$settings, pinnedModels: pinnedModels });
	await updateUserSettings(localStorage.token, { ui: $settings });
};

onMount(async () => {
	await init();
	const id = $page.url.searchParams.get('id');

	if (id) {
		selectedModelId = id;
	}

	const onKeyDown = (event) => {
		if (event.key === 'Shift') {
			shiftKey = true;
		}
	};

	const onKeyUp = (event) => {
		if (event.key === 'Shift') {
			shiftKey = false;
		}
	};

	const onBlur = () => {
		shiftKey = false;
	};

	window.addEventListener('keydown', onKeyDown);
	window.addEventListener('keyup', onKeyUp);
	window.addEventListener('blur', onBlur);

	return () => {
		window.removeEventListener('keydown', onKeyDown);
		window.removeEventListener('keyup', onKeyUp);
		window.removeEventListener('blur', onBlur);
	};
});
</script>

<ConfirmDialog
	title={$i18n.t('Reset All Models')}
	message={$i18n.t('This will delete all models including custom models and cannot be undone.')}
	bind:show={showResetModal}
	onConfirm={async () => {
		const res = await deleteAllModels(localStorage.token);
		if (res) {
			toast.success($i18n.t('All models deleted successfully'));
			await init();
		}
	}}
/>

<ManageModelsModal bind:show={showManageModal} />

{#if models !== null}
	{#if selectedModelId === null}
		<div class="flex h-full min-h-0 flex-col text-sm">
			<div class="mb-2 flex items-center justify-between">
				<h2 class="text-sm font-medium text-gray-900 dark:text-white">
					{$i18n.t('Models')}
					<span class="ml-2 font-normal text-gray-500 dark:text-gray-500">
						{filteredModels.length}
					</span>
				</h2>
			</div>

			{#if $user?.role === 'admin'}
				<input
					id="models-import-input"
					bind:this={modelsImportInputElement}
					bind:files={importFiles}
					type="file"
					accept=".json"
					hidden
					on:change={() => {
						if (importFiles.length > 0) {
							const reader = new FileReader();
							reader.onload = async (event) => {
								modelsImportInProgress = true;

								try {
									const models = JSON.parse(String(event.target.result));
									const res = await importModels(localStorage.token, models);

									if (res) {
										toast.success($i18n.t('Models imported successfully'));
										await init();
									} else {
										toast.error($i18n.t('Failed to import models'));
									}
								} catch (e) {
									toast.error(e?.detail ?? $i18n.t('Invalid JSON file'));
									console.error(e);
								}

								modelsImportInProgress = false;
							};
							reader.readAsText(importFiles[0]);
						}
					}}
				/>
			{/if}

			<div class="flex min-h-0 flex-1 flex-col space-y-1">
				<ModelDefaultsPanel
					bind:this={modelDefaultsPanel}
					bind:dirty={modelDefaultsDirty}
					initHandler={init}
				/>

				<div class="flex h-8 shrink-0 items-center w-full gap-2">
					<div class="flex min-w-0 flex-1 items-center">
						<div class=" self-center ml-1 mr-3">
							<Search className="size-3.5" />
						</div>
						<input
							data-settings-search
							class=" w-full text-sm py-1 rounded-r-xl outline-hidden bg-transparent"
							bind:value={searchValue}
							placeholder={$i18n.t('Search Models')}
						/>

						<button
							class="flex text-xs items-center space-x-1 px-3 py-1.5 rounded-xl bg-gray-50 hover:bg-gray-100 dark:bg-gray-850 dark:hover:bg-gray-800 dark:text-gray-200 transition"
							disabled={modelsImportInProgress}
							on:click={() => {
								modelsImportInputElement.click();
							}}
						>
							{#if modelsImportInProgress}
								<Spinner className="size-3" />
							{/if}
							<div class=" self-center font-medium line-clamp-1">
								{$i18n.t('Import')}
							</div>
						</button>

						<button
							class="flex text-xs items-center space-x-1 px-3 py-1.5 rounded-xl bg-gray-50 hover:bg-gray-100 dark:bg-gray-850 dark:hover:bg-gray-800 dark:text-gray-200 transition"
							on:click={async () => {
								downloadModels(models);
							}}
						>
							<div class=" self-center font-medium line-clamp-1">
								{$i18n.t('Export')}
							</div>
						</button>
					{/if}

					<button
						class="flex text-xs items-center space-x-1 px-3 py-1.5 rounded-xl bg-gray-50 hover:bg-gray-100 dark:bg-gray-850 dark:hover:bg-gray-800 dark:text-gray-200 transition"
						type="button"
						on:click={() => {
							showManageModal = true;
						}}
					>
						<div class=" self-center font-medium line-clamp-1">
							{$i18n.t('Manage')}
						</div>
					</button>

					<button
						class="flex text-xs items-center space-x-1 px-3 py-1.5 rounded-xl bg-black hover:bg-gray-900 text-white dark:bg-white dark:hover:bg-gray-100 dark:text-black transition font-medium"
						type="button"
						on:click={() => {
							showConfigModal = true;
						}}
					>
						<div class=" self-center font-medium line-clamp-1">
							{$i18n.t('Settings')}
						</div>
					</button>
				</div>
			</div>
		</div>

		<div
			class="py-2 bg-white dark:bg-gray-900 rounded-3xl border border-gray-100/30 dark:border-gray-850/30"
		>
			<div class="px-3.5 flex flex-1 items-center w-full space-x-2 py-0.5 pb-2">
				<div class="flex flex-1 items-center">
					<div class=" self-center ml-1 mr-3">
						<Search className="size-3.5" />
					</div>
					<input
						class=" w-full text-sm py-1 rounded-r-xl outline-hidden bg-transparent"
						bind:value={searchValue}
						placeholder={$i18n.t('Search Models')}
					/>
					{#if searchValue}
						<div class="self-center pl-1.5 translate-y-[0.5px] rounded-l-xl bg-transparent">
							<button
								class="p-0.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-900 transition"
								on:click={() => {
									searchValue = '';
								}}
							>
								<XMark className="size-3" strokeWidth="2" />
							</button>
						</div>
					{/if}
				</div>
			</div>

			<div class="px-3 flex w-full items-center bg-transparent overflow-x-auto scrollbar-none">
				<div
					class="flex gap-0.5 w-fit text-center text-sm rounded-full bg-transparent whitespace-nowrap"
				>
					<AdminViewSelector bind:value={viewOption} />
					{#if (tags ?? []).length > 0}
						<TagSelector
							bind:value={selectedTag}
							items={tags.map((tag) => ({ value: tag, label: tag }))}
							onChange={async () => {
								currentPage = 1;
								await init();
							}}
						/>
					{/if}
				</div>

				<div class="flex-1"></div>

				<Dropdown>
					<Tooltip content={$i18n.t('Actions')}>
						<button
							class="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition"
							type="button"
						>
							<EllipsisHorizontal className="size-4" />
						</button>
					</Tooltip>

					<div slot="content">
						<DropdownMenu.Content
							class="w-full max-w-[170px] rounded-xl p-1 border border-gray-100 dark:border-gray-800 z-50 bg-white dark:bg-gray-850 dark:text-white shadow-sm"
							sideOffset={-2}
							side="bottom"
							align="end"
							transition={flyAndScale}
						>
							<DropdownMenu.Item
								class="select-none flex gap-2 items-center px-3 py-1.5 text-sm font-medium cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded-md"
								on:click={() => {
									enableAllHandler();
								}}
							>
								<CheckCircle className="size-4" />
								<div class="flex items-center">{$i18n.t('Enable All')}</div>
							</DropdownMenu.Item>

							<DropdownMenu.Item
								class="select-none flex gap-2 items-center px-3 py-1.5 text-sm font-medium cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded-md"
								on:click={() => {
									disableAllHandler();
								}}
							>
								<Minus className="size-4" />
								<div class="flex items-center">{$i18n.t('Disable All')}</div>
							</DropdownMenu.Item>

							<hr class="border-gray-100 dark:border-gray-800 my-1" />

							<DropdownMenu.Item
								class="select-none flex gap-2 items-center px-3 py-1.5 text-sm font-medium cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded-md"
								on:click={() => {
									showAllHandler();
								}}
							>
								<Eye className="size-4" />
								<div class="flex items-center">{$i18n.t('Show All')}</div>
							</DropdownMenu.Item>

							<DropdownMenu.Item
								class="select-none flex gap-2 items-center px-3 py-1.5 text-sm font-medium cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded-md"
								on:click={() => {
									hideAllHandler();
								}}
							>
								<EyeSlash className="size-4" />
								<div class="flex items-center">{$i18n.t('Hide All')}</div>
							</DropdownMenu.Item>
						</DropdownMenu.Content>
					</div>
				</Dropdown>
			</div>

			<div class="px-3 my-2" id="model-list">
				{#if filteredModels.length > 0}
					{#each filteredModels.slice((currentPage - 1) * perPage, currentPage * perPage) as model, modelIdx (`${model.id}-${modelIdx}`)}
						<div
							class=" flex space-x-4 cursor-pointer w-full px-3 py-2 dark:hover:bg-white/5 hover:bg-black/5 rounded-xl transition {model
								?.meta?.hidden
								? 'opacity-50 dark:opacity-50'
								: ''}"
							id="model-item-{model.id}"
						>
							<button
								class=" flex flex-1 text-left space-x-3.5 cursor-pointer w-full"
								type="button"
								on:click={() => {
									selectedModelId = model.id;
								}}
							>
								<div class=" self-center w-9">
									<div
										class=" rounded-full object-cover {(model?.is_active ?? true)
											? ''
											: 'opacity-50 dark:opacity-50'} "
									>
										<img
											src={`${WEBUI_API_BASE_URL}/models/model/profile/image?id=${model.id}`}
											alt="modelfile profile"
											class=" rounded-full w-full h-auto object-cover"
										/>
									</div>
								</div>

								<div
									class=" flex-1 self-center {(model?.is_active ?? true) ? '' : 'text-gray-500'}"
								>
									<XMark className="size-3" strokeWidth="2" />
								</button>
							</div>
						{/if}
					</div>

					<div
						class="flex max-w-[60%] shrink-0 items-center gap-1 overflow-x-auto scrollbar-none"
						bind:this={tagsContainerElement}
						on:wheel={(e) => {
							if (e.deltaY !== 0) {
								e.preventDefault();
								e.currentTarget.scrollLeft += e.deltaY;
							}
						}}
					>
						<div
							class="flex w-fit gap-0.5 text-center text-sm rounded-full bg-transparent whitespace-nowrap"
						>
							<AdminViewSelector bind:value={viewOption} align="end" />

							{#if (tags ?? []).length > 0}
								<TagSelector
									bind:value={selectedTag}
									align="end"
									items={tags.map((tag) => {
										return { value: tag, label: tag };
									})}
									onChange={async () => {
										await init();
									}}
								/>
							{/if}
						</div>

						<Dropdown align="end">
							<Tooltip content={$i18n.t('Actions')}>
								<button
									class="flex h-8 items-center gap-1.5 rounded-xl bg-transparent px-1.5 text-[13px] font-normal text-gray-700 transition hover:text-gray-900 dark:text-gray-200 dark:hover:text-gray-100"
									type="button"
								>
									<span>{$i18n.t('Actions')}</span>
									<ChevronDown className="size-3" strokeWidth="2.5" />
								</button>
							</Tooltip>

							<div slot="content">
								<DropdownMenu className="w-[170px] shadow-sm">
									{#if $user?.role === 'admin'}
										<button
											class="flex h-[1.6875rem] w-full cursor-pointer select-none items-center gap-2 rounded-xl bg-transparent px-2 text-[13px] disabled:pointer-events-none disabled:opacity-40 hover:text-gray-900 dark:hover:text-gray-100"
											type="button"
											disabled={modelsImportInProgress}
											on:click={() => {
												modelsImportInputElement?.click();
											}}
										>
											<DocumentArrowUp className="size-3.5" />
											<div class="flex items-center">{$i18n.t('Import')}</div>
										</button>

										<button
											class="flex h-[1.6875rem] w-full cursor-pointer select-none items-center gap-2 rounded-xl bg-transparent px-2 text-[13px] hover:text-gray-900 dark:hover:text-gray-100"
											type="button"
											on:click={() => {
												downloadModels(models ?? []);
											}}
										>
											<Download className="size-3.5" />
											<div class="flex items-center">{$i18n.t('Export')}</div>
										</button>
									{/if}

									<button
										class="flex h-[1.6875rem] w-full cursor-pointer select-none items-center gap-2 rounded-xl bg-transparent px-2 text-[13px] hover:text-gray-900 dark:hover:text-gray-100"
										type="button"
										on:click={() => {
											showManageModal = true;
										}}
									>
										<Wrench className="size-3.5" />
										<div class="flex items-center">{$i18n.t('Manage')}</div>
									</button>

									<button
										class="flex h-[1.6875rem] w-full cursor-pointer select-none items-center gap-2 rounded-xl bg-transparent px-2 text-[13px] hover:text-gray-900 dark:hover:text-gray-100"
										type="button"
										on:click={() => {
											showResetModal = true;
										}}
									>
										<GarbageBin className="size-3.5" />
										<div class="flex items-center">{$i18n.t('Reset')}</div>
									</button>

									<hr class="mx-1 my-0.5 border-gray-100 dark:border-gray-800" />

									<button
										class="flex h-[1.6875rem] w-full cursor-pointer select-none items-center gap-2 rounded-xl bg-transparent px-2 text-[13px] hover:text-gray-900 dark:hover:text-gray-100"
										type="button"
										on:click={() => {
											enableAllHandler();
										}}
									>
										<CheckCircle className="size-3.5" />
										<div class="flex items-center">{$i18n.t('Enable All')}</div>
									</button>

									<button
										class="flex h-[1.6875rem] w-full cursor-pointer select-none items-center gap-2 rounded-xl bg-transparent px-2 text-[13px] hover:text-gray-900 dark:hover:text-gray-100"
										type="button"
										on:click={() => {
											disableAllHandler();
										}}
									>
										<Minus className="size-3.5" />
										<div class="flex items-center">{$i18n.t('Disable All')}</div>
									</button>

									<hr class="mx-1 my-0.5 border-gray-100 dark:border-gray-800" />

									<button
										class="flex h-[1.6875rem] w-full cursor-pointer select-none items-center gap-2 rounded-xl bg-transparent px-2 text-[13px] hover:text-gray-900 dark:hover:text-gray-100"
										type="button"
										on:click={() => {
											showAllHandler();
										}}
									>
										<Eye className="size-3.5" />
										<div class="flex items-center">{$i18n.t('Show All')}</div>
									</button>

									<button
										class="flex h-[1.6875rem] w-full cursor-pointer select-none items-center gap-2 rounded-xl bg-transparent px-2 text-[13px] hover:text-gray-900 dark:hover:text-gray-100"
										type="button"
										on:click={() => {
											hideAllHandler();
										}}
									>
										<EyeSlash className="size-3.5" />
										<div class="flex items-center">{$i18n.t('Hide All')}</div>
									</button>
								</DropdownMenu>
							</div>
						</Dropdown>
					</div>
				</div>

				<div
					class="my-0.5 min-h-0 flex-1 space-y-px {filteredModels.length > 0
						? 'overflow-y-auto scrollbar-hover pr-1.5'
						: 'overflow-hidden'}"
					id="model-list"
					bind:this={modelListElement}
				>
					{#if filteredModels.length > 0}
						{#each filteredModels as model, modelIdx (`${model.id}-${modelIdx}`)}
							<div
								class="flex cursor-pointer transition w-full px-2 py-1 rounded-xl hover:bg-gray-50/70 dark:hover:bg-gray-850/50 {model
									?.meta?.hidden
									? 'opacity-50 dark:opacity-50'
									: ''}"
								id="model-item-{model.id}"
							>
								<div class="self-center pr-1 -ml-1 text-gray-400 dark:text-gray-600">
									<Tooltip
										content={canReorderModels
											? $i18n.t('Drag to reorder')
											: $i18n.t('Clear filters to reorder')}
									>
										<EllipsisVertical
											className="size-4 {canReorderModels
												? 'cursor-move model-item-handle'
												: 'opacity-40'}"
										/>
									</Tooltip>
								</div>

								<button
									class="flex group/item gap-2.5 w-full min-w-0 flex-1 text-left cursor-pointer"
									type="button"
									on:click={() => {
										selectedModelId = model.id;
									}}
								>
									<div class="self-center">
										<div class="flex bg-white rounded-xl">
											<div
												class="{(model?.is_active ?? true)
													? ''
													: 'opacity-50 dark:opacity-50'} bg-transparent rounded-xl"
											>
												<img
													src={`${WEBUI_API_BASE_URL}/models/model/profile/image?id=${model.id}&lang=${$i18n.language}`}
													alt="modelfile profile"
													class=" rounded-xl size-7 object-cover"
													loading="lazy"
													decoding="async"
													on:error={(e) => {
														e.target.src = '/favicon.png';
													}}
												/>
											</div>
										</div>
									</div>

									<div
										class="flex min-w-0 flex-1 pr-1 self-center {(model?.is_active ?? true)
											? ''
											: 'text-gray-500'}"
									>
										<Tooltip
											content={marked.parse(
												!!model?.meta?.description
													? model?.meta?.description
													: model?.ollama?.digest
														? `${model?.ollama?.digest} **(${model?.ollama?.modified_at})**`
														: model.id
											)}
											className="min-w-0 flex-1"
											placement="top-start"
										>
											<div
												class="flex min-w-0 items-center gap-1.5 text-[13px] font-normal leading-4"
											>
												<span class="min-w-0 truncate">{model.name}</span>

												<span
													class="shrink-0 text-[11px] font-normal leading-4 {modelAccessClass(
														model
													)}"
												>
													{modelAccessLabel(model)}
												</span>

												{#if defaultModelIdSet.has(model.id)}
													<span
														class="shrink-0 text-[11px] font-normal leading-4 text-gray-500 dark:text-gray-400"
													>
														{$i18n.t('Selected')}
													</span>
												{/if}

												{#if defaultPinnedModelIdSet.has(model.id)}
													<span
														class="shrink-0 text-[11px] font-normal leading-4 text-gray-500 dark:text-gray-400"
													>
														{$i18n.t('Pinned')}
													</span>
												{/if}
											</div>
										</Tooltip>
									</div>
								</button>
								<div class="flex shrink-0 flex-row gap-0.5 items-center self-center">
									{#if shiftKey}
										<Tooltip content={model?.meta?.hidden ? $i18n.t('Show') : $i18n.t('Hide')}>
											<button
												class="self-center w-fit text-sm p-1.5 dark:text-gray-300 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded-xl"
												type="button"
												on:click={() => {
													hideModelHandler(model);
												}}
											>
												{#if model?.meta?.hidden}
													<EyeSlash />
												{:else}
													<Eye />
												{/if}
											</button>
										</Tooltip>

										<Tooltip
											content={defaultModelIdSet.has(model.id)
												? $i18n.t('Remove Selected Model')
												: $i18n.t('Set as Selected Model')}
										>
											<button
												class="self-center w-fit text-sm p-1.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 {defaultModelIdSet.has(
													model.id
												)
													? 'text-gray-900 dark:text-white'
													: 'text-gray-500 dark:text-gray-400 dark:hover:text-white'}"
												type="button"
												aria-label={defaultModelIdSet.has(model.id)
													? $i18n.t('Remove Selected Model')
													: $i18n.t('Set as Selected Model')}
												on:click={() => {
													toggleDefaultModelHandler(model);
												}}
											>
												<Check className="size-3.5" />
											</button>
										</Tooltip>

										<Tooltip
											content={defaultPinnedModelIdSet.has(model.id)
												? $i18n.t('Remove Pinned Model')
												: $i18n.t('Set as Pinned Model')}
										>
											<button
												class="self-center w-fit text-sm p-1.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 {defaultPinnedModelIdSet.has(
													model.id
												)
													? 'text-gray-900 dark:text-white'
													: 'text-gray-500 dark:text-gray-400 dark:hover:text-white'}"
												type="button"
												aria-label={defaultPinnedModelIdSet.has(model.id)
													? $i18n.t('Remove Pinned Model')
													: $i18n.t('Set as Pinned Model')}
												on:click={() => {
													toggleDefaultPinnedModelHandler(model);
												}}
											>
												{#if defaultPinnedModelIdSet.has(model.id)}
													<PinSlash className="size-3.5" />
												{:else}
													<Pin className="size-3.5" />
												{/if}
											</button>
										</Tooltip>

										<Tooltip
											content={isPublicModel(model)
												? $i18n.t('Make Private')
												: $i18n.t('Make Public')}
										>
											<button
												class="self-center w-fit text-sm p-1.5 rounded-xl text-gray-500 hover:bg-black/5 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-white"
												type="button"
												aria-label={isPublicModel(model)
													? $i18n.t('Make Private')
													: $i18n.t('Make Public')}
												on:click={() => {
													toggleModelPrivacyHandler(model);
												}}
											>
												{#if isPublicModel(model)}
													<LockClosed className="size-3.5" />
												{:else}
													<GlobeAlt className="size-3.5" />
												{/if}
											</button>
										</Tooltip>
									{/if}

									<button
										class="hidden sm:flex self-center w-fit text-sm p-1.5 dark:text-gray-300 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded-xl"
										type="button"
										aria-label={$i18n.t('Edit')}
										on:click={() => {
											selectedModelId = model.id;
										}}
									>
										<svg
											xmlns="http://www.w3.org/2000/svg"
											fill="none"
											viewBox="0 0 24 24"
											stroke-width="1.5"
											stroke="currentColor"
											class="size-3.5"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125"
											/>
										</svg>
									</button>

									<ModelMenu
										user={$user}
										{model}
										exportHandler={() => {
											exportModelHandler(model);
										}}
										hideHandler={() => {
											hideModelHandler(model);
										}}
										privacyHandler={() => {
											toggleModelPrivacyHandler(model);
										}}
										isDefaultSelected={defaultModelIdSet.has(model.id)}
										isDefaultPinned={defaultPinnedModelIdSet.has(model.id)}
										defaultSelectedHandler={() => {
											toggleDefaultModelHandler(model);
										}}
										defaultPinnedHandler={() => {
											toggleDefaultPinnedModelHandler(model);
										}}
										pinModelHandler={() => {
											pinModelHandler(model.id);
										}}
										copyLinkHandler={() => {
											copyLinkHandler(model);
										}}
										cloneHandler={() => {
											cloneHandler(model);
										}}
										onClose={() => {}}
									>
										<button
											class="self-center w-fit text-sm p-1.5 dark:text-gray-300 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded-xl"
											type="button"
										>
											<EllipsisHorizontal className="size-3.5" />
										</button>
									</ModelMenu>

									<div class="ml-1">
										<Tooltip
											content={(model?.is_active ?? true)
												? $i18n.t('Enabled')
												: $i18n.t('Disabled')}
										>
											<Switch
												bind:state={model.is_active}
												on:change={async () => {
													toggleModelHandler(model);
												}}
											/>
										</Tooltip>
									</div>
								</div>
							</div>
						{/each}
					{:else}
						<div class="flex h-full w-full items-center justify-center py-10">
							<div class="max-w-md text-center">
								<div class="mb-2 text-xl">😕</div>
								<div class="mb-1 text-sm text-gray-700 dark:text-gray-300">
									{$i18n.t('No models found')}
								</div>
								<div class=" text-gray-500 text-center text-xs">
									{$i18n.t('Try adjusting your search or filter to find what you are looking for.')}
								</div>
							</div>
						</div>
					{/if}
				</div>

				<div class="flex justify-end pt-6 text-sm font-normal">
					<button
						class="flex items-center gap-2 px-3.5 py-1.5 text-sm font-normal bg-black hover:bg-gray-900 text-white dark:bg-white dark:text-black dark:hover:bg-gray-100 transition rounded-full disabled:cursor-not-allowed disabled:opacity-40"
						type="button"
						disabled={(!modelOrderDirty && !modelDefaultsDirty) ||
							savingModelOrder ||
							savingModelsSettings}
						on:click={async () => {
							await saveModelsSettings();
						}}
					>
						{$i18n.t('Save')}
						{#if savingModelOrder || savingModelsSettings}
							<span class="shrink-0">
								<Spinner />
							</span>
						{/if}
					</button>
				</div>
			</div>
		</div>
	{:else}
		<ModelEditor
			edit
			model={models.find((m) => m.id === selectedModelId)}
			preset={false}
			onSubmit={async (model) => {
				console.log(model);
				await upsertModelHandler(model);
				selectedModelId = null;
				await init();
			}}
			onBack={async () => {
				selectedModelId = null;
				await init();
			}}
		/>
	{/if}
{:else}
	<div class=" h-full w-full flex justify-center items-center">
		<Spinner className="size-5" />
	</div>
{/if}
