<script setup>
  import { checkVotingCode } from "../generateBallot.js";
  import { ref, computed } from "vue";

  const props = defineProps(["state", "loaded"]);
  const questions = computed(() => {
    return props.state.setup
      ? props.state.setup.payload.election.questions
      : [];
  });

  const generateBallot = (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const data = {};
    formData.forEach((value, key) => {
      data[key] = value;
    });
    console.log(data);
  }

  const credential = ref("");
  const checkCode = () => {
    checkVotingCode(props.state, credential.value.trim());
  }

</script>

<template>
  <div class="uk-modal p-6" id="generate-ballot-modal" uk-modal>
    <div class="uk-modal-body uk-modal-dialog">
      <h2 class="uk-modal-title">Generate a ballot</h2>
      <div class="uk-form-stacked uk-margin">
        <div id="generate-ballot-form">

        </div>
          <form @submit="generateBallot">
            <div class="uk-margin">
              <label class="uk-form-label" for="generate-ballot-private-key">
                Code de vote
              </label>
              <div class="uk-form-controls">
                <input
                type="text"
                class="uk-input"
                v-model="credential"
                placeholder="Paste your code"
                />
              </div>

              <button class="uk-button uk-button-default" type="button" @click="checkCode">
                Check
              </button>
            </div>

            <div class="uk-margin" v-for="(question, i) in questions" v-bind:key="i">
              <div class="uk-margin">
                <label class="uk-form-label" v-bind:for="'q-'+i">
                  {{ question.question }}
                </label>
                <div class="uk-form-controls">
                  <select class="uk-select generate-ballot-input" v-bind:name="'q-'+i">
                    <option value="">Select an answer</option>
                    <option v-bind:value="j" v-for="(answer, j) in question.answers" v-bind:key="j">
                      {{ answer }}
                    </option>
                  </select>
                </div>
              </div>
              <input type="submit" class="uk-button uk-button-default" value="Generate ballot" />
            </div>
          </form>
        <div class="uk-margin">
          <label class="uk-form-label" for="generate-ballot-ballot"
            >Your ballot</label
          >
          <textarea
            id="generate-ballot-ballot"
            class="uk-textarea"
            rows="5"
            placeholder="Textarea"
            aria-label="Textarea"
            style="white-space: pre-wrap"
            readonly
          ></textarea>
        </div>
      </div>
      <button class="uk-modal-close uk-button uk-button-default" type="button">
        Close
      </button>
    </div>
  </div>
</template>